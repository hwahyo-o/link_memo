import { createRemoteJWKSet, jwtVerify } from "jose";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "link-memo-img";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FIREBASE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const accessTokenCache = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function corsHeaders(origin, env) {
  return {
    "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Link-Memo-File-Name, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function base64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function unbase64(value, errorCode = "DRIVE_CREDENTIALS_CORRUPTED") {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(errorCode), { status: 500 });
  }
  try {
    const text = atob(value);
    return Uint8Array.from(text, char => char.charCodeAt(0));
  } catch {
    throw Object.assign(new Error(errorCode), { status: 500 });
  }
}

async function encryptionKey(env) {
  const secret = typeof env.TOKEN_ENCRYPTION_KEY === "string" ? env.TOKEN_ENCRYPTION_KEY.trim() : "";
  if (secret.length < 32) throw Object.assign(new Error("TOKEN_ENCRYPTION_KEY_INVALID"), { status: 500 });
  // 대시보드 Secret의 임의 문자열에서 고정 256-bit AES 키를 파생합니다.
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return { ciphertext: base64(new Uint8Array(encrypted)), iv: base64(iv) };
}

async function decrypt(record, env) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(record.iv) },
    await encryptionKey(env),
    unbase64(record.refresh_token)
  );
  return new TextDecoder().decode(decrypted);
}

async function requireFirebaseUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("UNAUTHENTICATED"), { status: 401 });
  const token = authorization.slice(7);
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID
  });
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw Object.assign(new Error("GOOGLE_LOGIN_REQUIRED"), { status: 403 });
  }
  return { uid: payload.user_id || payload.sub, email: String(payload.email).toLowerCase() };
}

async function verifyGoogleIdentity(idToken, env) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.GOOGLE_CLIENT_ID
  });
  if (!payload.email || payload.email_verified !== true) throw Object.assign(new Error("GOOGLE_EMAIL_UNVERIFIED"), { status: 403 });
  return String(payload.email).toLowerCase();
}

async function tokenRequest(params, env) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params
    })
  });
  if (!response.ok) throw Object.assign(new Error("GOOGLE_TOKEN_EXCHANGE_FAILED"), { status: 401 });
  return response.json();
}

async function driveAccessToken(uid, env) {
  const cached = accessTokenCache.get(uid);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const record = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT refresh_token, iv FROM drive_credentials WHERE uid = ?"
  ).bind(uid).first();
  if (!record) throw Object.assign(new Error("DRIVE_NOT_CONNECTED"), { status: 403 });
  const refreshToken = await decrypt(record, env);
  const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, env);
  if (!token.access_token) throw Object.assign(new Error("DRIVE_TOKEN_REFRESH_FAILED"), { status: 401 });
  accessTokenCache.set(uid, {
    token: token.access_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 300) - 60) * 1000
  });
  return token.access_token;
}

async function driveFetch(accessToken, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw Object.assign(new Error(`DRIVE_API_${response.status}`), { status: response.status });
  return response;
}

async function ensureFolder(accessToken) {
  const query = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const listed = await (await driveFetch(accessToken, `?q=${query}&fields=files(id)`)).json();
  if (listed.files?.[0]?.id) return listed.files[0].id;
  const created = await (await driveFetch(accessToken, "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  })).json();
  return created.id;
}

async function connect(request, user, env) {
  if (request.headers.get("X-Requested-With") !== "link-memo") {
    throw Object.assign(new Error("INVALID_CONNECT_REQUEST"), { status: 403 });
  }
  const body = await request.json();
  if (!body?.authorizationCode) throw Object.assign(new Error("AUTHORIZATION_CODE_REQUIRED"), { status: 400 });
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code: body.authorizationCode,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI
  }, env);
  if (!tokens.id_token || !tokens.access_token) {
    throw Object.assign(new Error("GOOGLE_TOKEN_EXCHANGE_FAILED"), { status: 401 });
  }
  const driveEmail = await verifyGoogleIdentity(tokens.id_token, env);
  if (driveEmail !== user.email) throw Object.assign(new Error("DRIVE_ACCOUNT_MISMATCH"), { status: 403 });

  const existing = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT refresh_token, iv FROM drive_credentials WHERE uid = ?"
  ).bind(user.uid).first();
  let retainedRefreshToken = null;
  if (!tokens.refresh_token && existing) {
    try {
      retainedRefreshToken = await decrypt(existing, env);
    } catch {
      throw Object.assign(new Error("DRIVE_CREDENTIALS_RECOVERY_REQUIRED"), { status: 409 });
    }
  }
  const refreshToken = tokens.refresh_token || retainedRefreshToken;
  if (!refreshToken) throw Object.assign(new Error("DRIVE_OFFLINE_ACCESS_REQUIRED"), { status: 400 });

  const folderId = await ensureFolder(tokens.access_token);
  const encrypted = await encrypt(refreshToken, env);
  await env.DRIVE_CREDENTIALS.prepare(
    `INSERT INTO drive_credentials (uid, refresh_token, iv, drive_email, folder_id, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(uid) DO UPDATE SET refresh_token = excluded.refresh_token, iv = excluded.iv,
       drive_email = excluded.drive_email, folder_id = excluded.folder_id, updated_at = unixepoch()`
  ).bind(user.uid, encrypted.ciphertext, encrypted.iv, driveEmail, folderId).run();
  accessTokenCache.set(user.uid, {
    token: tokens.access_token,
    expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in || 300) - 60) * 1000
  });
  return json({ permissionGranted: true, folderId, connectedAt: Date.now() });
}

async function verifyImages(request, user, env) {
  const body = await request.json();
  const fileIds = [...new Set((body?.fileIds || []).filter(value => typeof value === "string" && value.length > 0))].slice(0, 50);
  if (!fileIds.length) return json({ images: [] });
  const accessToken = await driveAccessToken(user.uid, env);
  const images = await Promise.all(fileIds.map(async fileId => {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.ok) {
      const file = await response.json();
      return { fileId, state: file.trashed ? "missing" : "available" };
    }
    if (response.status === 403 || response.status === 404) return { fileId, state: "missing" };
    throw Object.assign(new Error(`DRIVE_API_${response.status}`), { status: response.status });
  }));
  return json({ images });
}

async function upload(request, user, env) {
  const image = await request.blob();
  if (!image.type.startsWith("image/")) throw Object.assign(new Error("IMAGE_REQUIRED"), { status: 400 });
  if (image.size > MAX_IMAGE_BYTES) throw Object.assign(new Error("IMAGE_TOO_LARGE"), { status: 413 });
  const accessToken = await driveAccessToken(user.uid, env);
  const credential = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT folder_id FROM drive_credentials WHERE uid = ?"
  ).bind(user.uid).first();
  const fileName = decodeURIComponent(request.headers.get("X-Link-Memo-File-Name") || `image-${Date.now()}`);
  const boundary = `link-memo-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: fileName.slice(0, 180),
    mimeType: image.type,
    parents: credential?.folder_id ? [credential.folder_id] : undefined
  });
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${image.type}\r\n\r\n`,
    image,
    `\r\n--${boundary}--`
  ]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body: multipart
  });
  if (!response.ok) throw Object.assign(new Error(`DRIVE_API_${response.status}`), { status: response.status });
  return json(await response.json());
}

async function image(fileId, user, env) {
  const accessToken = await driveAccessToken(user.uid, env);
  const response = await driveFetch(accessToken, `/${encodeURIComponent(fileId)}?alt=media`);
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-site",
      Vary: "Authorization, Origin"
    }
  });
}

async function remove(fileId, user, env) {
  const accessToken = await driveAccessToken(user.uid, env);
  await driveFetch(accessToken, `/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  return new Response(null, { status: 204 });
}

async function disconnect(user, env) {
  const record = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT refresh_token, iv FROM drive_credentials WHERE uid = ?"
  ).bind(user.uid).first();
  let permissionRevoked = false;
  if (record) {
    try {
      const refreshToken = await decrypt(record, env);
      const revoked = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken })
      });
      permissionRevoked = revoked.ok;
    } catch (error) {
      // 잘못된 키나 손상된 행이어도 현재 사용자 행은 반드시 삭제해 재연결을 가능하게 합니다.
      console.warn("Drive permission revoke skipped", error?.message || error);
    }
  }
  await env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_credentials WHERE uid = ?").bind(user.uid).run();
  accessTokenCache.delete(user.uid);
  return json({ disconnected: true, permissionRevoked });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
    const headers = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const user = await requireFirebaseUser(request, env);
      const path = new URL(request.url).pathname.replace(/^\/+/, "");
      let response;
      if (request.method === "POST" && path === "connect") response = await connect(request, user, env);
      else if (request.method === "GET" && path === "session") {
        const record = await env.DRIVE_CREDENTIALS.prepare("SELECT folder_id FROM drive_credentials WHERE uid = ?").bind(user.uid).first();
        if (record && new URL(request.url).searchParams.get("warm") === "1") await driveAccessToken(user.uid, env);
        response = json({ active: Boolean(record), folderId: record?.folder_id || null });
      } else if (request.method === "POST" && path === "images/verify") response = await verifyImages(request, user, env);
      else if (request.method === "POST" && path === "upload") response = await upload(request, user, env);
      else if (request.method === "GET" && path.startsWith("image/")) response = await image(path.slice(6), user, env);
      else if (request.method === "DELETE" && path.startsWith("image/")) response = await remove(path.slice(6), user, env);
      else if (request.method === "POST" && path === "disconnect") response = await disconnect(user, env);
      else response = json({ error: "NOT_FOUND" }, 404);
      const merged = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      return new Response(response.body, { status: response.status, headers: merged });
    } catch (error) {
      console.error(error?.message || error);
      return json({ error: error?.message || "INTERNAL_ERROR" }, error?.status || 500, headers);
    }
  }
};
