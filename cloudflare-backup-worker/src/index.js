const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const API_VERSION = 1;
let jwksCache = { expires: 0, keys: [] };
function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? { "access-control-allow-origin": origin, "vary": "Origin", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" } : {};
}
function json(value, status, origin, env) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...cors(origin, env) } }); }
function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), character => character.charCodeAt(0));
}
function decodeJson(value) { return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))); }
export function hasValidFirebaseAuthTime(claims, now = Date.now()) {
  const authTime = Number(claims?.auth_time);
  return Number.isFinite(authTime) && authTime > 0 && authTime * 1000 <= now + 60_000;
}
export function isAnonymousFirebaseToken(claims) {
  return claims?.firebase?.sign_in_provider === "anonymous";
}
async function getJwks({ forceRefresh = false } = {}) {
  if (!forceRefresh && jwksCache.keys.length && Date.now() < jwksCache.expires) return jwksCache.keys;
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("FIREBASE_JWKS_FETCH_FAILED");
  const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("FIREBASE_JWKS_INVALID");
  jwksCache = { keys: body.keys, expires: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}
async function verifyToken(request, env) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error("WORKER_CONFIG_MISSING");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/, "");
  if (!token) throw new Error("UNAUTHENTICATED");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("INVALID_TOKEN");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  let header, claims, signature;
  try {
    header = decodeJson(encodedHeader);
    claims = decodeJson(encodedClaims);
    signature = base64UrlBytes(encodedSignature);
  } catch {
    throw new Error("INVALID_TOKEN");
  }
  const now = Date.now();
  if (header.alg !== "RS256" || !header.kid || !claims.sub || claims.sub.length > 128) throw new Error("INVALID_TOKEN");
  if (claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error("TOKEN_PROJECT_MISMATCH");
  if (!claims.exp || claims.exp * 1000 < now || !claims.iat || claims.iat * 1000 > now + 60_000 || !hasValidFirebaseAuthTime(claims, now)) throw new Error("INVALID_TOKEN");
  let jwk = (await getJwks()).find(key => key.kid === header.kid);
  if (!jwk) jwk = (await getJwks({ forceRefresh: true })).find(key => key.kid === header.kid);
  if (!jwk) throw new Error("INVALID_TOKEN");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  if (!valid) throw new Error("INVALID_TOKEN");
  if (isAnonymousFirebaseToken(claims)) throw new Error("GUEST_UNSUPPORTED");
  return claims.sub;
}
function objectKey(uid, backupId) { return `users/${uid}/${backupId}.json`; }
function checkpointKey(uid) { return `checkpoints/${uid}/latest.json`; }
function validId(id) { return /^backup_[a-z0-9_-]{8,100}$/i.test(id || ""); }
function validDigest(value) { return /^[a-f0-9]{64}$/i.test(value || ""); }
function normalizeForChecksum(value) {
  if (Array.isArray(value)) return value.map(normalizeForChecksum);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalizeForChecksum(value[key])])
    );
  }
  return value;
}
async function digest(value, { stable = false } = {}) {
  const serialized = JSON.stringify(stable ? normalizeForChecksum(value) : value);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function listUserBackups(env, uid) {
  const listed = await env.BACKUPS.list({ prefix: `users/${uid}/`, include: ["customMetadata"] });
  const descriptors = await Promise.all(listed.objects.map(async object => {
    let metadata = object.customMetadata || {};
    if (!metadata.reason) {
      const legacy = await env.BACKUPS.get(object.key);
      const envelope = legacy ? await legacy.json().catch(() => ({})) : {};
      metadata = {
        reason: envelope.reason,
        createdAt: envelope.createdAt,
        checksum: envelope.checksum,
        payloadChecksum: envelope.payloadChecksum
      };
    }
    return {
      id: object.key.slice(object.key.lastIndexOf("/") + 1, -5),
      createdAt: Number(metadata.createdAt || object.uploaded?.getTime?.() || 0),
      reason: metadata.reason === "auto" ? "auto" : "manual",
      checksum: metadata.checksum || null,
      payloadChecksum: metadata.payloadChecksum || null,
      size: Number(object.size || 0)
    };
  }));
  return descriptors.sort((left, right) => right.createdAt - left.createdAt);
}
export function selectStaleBackupIds(backups) {
  return ["manual", "auto"].flatMap(reason =>
    backups.filter(item => item.reason === reason).sort((left, right) => right.createdAt - left.createdAt).slice(3).map(item => item.id)
  );
}
async function enforceRetention(env, uid) {
  const backups = await listUserBackups(env, uid);
  const staleIds = selectStaleBackupIds(backups);
  await Promise.all(staleIds.map(id => env.BACKUPS.delete(objectKey(uid, id))));
  return backups.filter(item => !staleIds.includes(item.id));
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, env) });
    if (origin && !cors(origin, env)["access-control-allow-origin"]) return json({ code: "ORIGIN_NOT_ALLOWED" }, 403, origin, env);
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return json({ service: "link-memo-backup", apiVersion: API_VERSION }, 200, origin, env);
      }
      const uid = await verifyToken(request, env);
      if (url.pathname === "/v1/checkpoints/latest") {
        const key = checkpointKey(uid);
        if (request.method === "GET") {
          const object = await env.BACKUPS.get(key);
          if (!object) return json({ code: "CHECKPOINT_NOT_FOUND" }, 404, origin, env);
          return new Response(object.body, { headers: { "content-type": "application/json", ...cors(origin, env) } });
        }
        if (request.method === "POST") {
          const contentLength = Number(request.headers.get("content-length") || 0);
          if (contentLength > 5_000_000) return json({ code: "CHECKPOINT_TOO_LARGE" }, 413, origin, env);
          const body = await request.json();
          if (body?.schemaVersion !== 1 || body?.userId !== uid || !Number.isFinite(Number(body.updatedAt)) || !body.payload || typeof body.payload !== "object") {
            return json({ code: "INVALID_CHECKPOINT" }, 400, origin, env);
          }
          const encoded = JSON.stringify(body);
          if (encoded.length > 5_000_000) return json({ code: "CHECKPOINT_TOO_LARGE" }, 413, origin, env);
          const current = await env.BACKUPS.get(key);
          if (current) {
            const previous = await current.json().catch(() => null);
            if (Number(previous?.updatedAt || 0) > Number(body.updatedAt)) return json({ saved: false, stale: true }, 200, origin, env);
          }
          await env.BACKUPS.put(key, encoded, { httpMetadata: { contentType: "application/json" } });
          return json({ saved: true, updatedAt: Number(body.updatedAt) }, 200, origin, env);
        }
        return json({ code: "METHOD_NOT_ALLOWED" }, 405, origin, env);
      }
      if (request.method === "GET" && url.pathname === "/v1/backups") {
        return json({ backups: await listUserBackups(env, uid) }, 200, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/backups") {
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > 5_000_000) return json({ code: "BACKUP_TOO_LARGE" }, 413, origin, env);
        const body = await request.json();
        const createdAt = Number(body.createdAt);
        const validReason = body.reason === "manual" || body.reason === "auto";
        if (
          !validId(body.backupId)
          || body.userId !== uid
          || body.schemaVersion !== 1
          || !Number.isFinite(createdAt)
          || createdAt <= 0
          || !validReason
          || !validDigest(body.checksum)
          || !validDigest(body.payloadChecksum)
        ) return json({ code: "INVALID_BACKUP" }, 400, origin, env);
        const encoded = JSON.stringify(body);
        if (encoded.length > 5_000_000) return json({ code: "BACKUP_TOO_LARGE" }, 413, origin, env);
        const comparable = { ...body };
        delete comparable.checksum;
        const [actualChecksum, actualPayloadChecksum] = await Promise.all([
          digest(comparable),
          digest(body.payload, { stable: true })
        ]);
        if (body.checksum !== actualChecksum || body.payloadChecksum !== actualPayloadChecksum) {
          return json({ code: "BACKUP_CHECKSUM_INVALID" }, 400, origin, env);
        }
        await env.BACKUPS.put(objectKey(uid, body.backupId), encoded, {
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            reason: body.reason,
            createdAt: String(createdAt),
            checksum: body.checksum,
            payloadChecksum: body.payloadChecksum
          }
        });
        await enforceRetention(env, uid);
        return json({
          backupId: body.backupId,
          createdAt,
          reason: body.reason,
          checksum: body.checksum,
          payloadChecksum: body.payloadChecksum,
          size: encoded.length
        }, 201, origin, env);
      }
      const match = url.pathname.match(/^\/v1\/backups\/([^/]+)$/);
      if (!match || !validId(match[1])) return json({ code: "NOT_FOUND" }, 404, origin, env);
      const key = objectKey(uid, match[1]);
      if (request.method === "GET") {
        const object = await env.BACKUPS.get(key);
        if (!object) return json({ code: "BACKUP_NOT_FOUND" }, 404, origin, env);
        return new Response(object.body, { headers: { "content-type": "application/json", ...cors(origin, env) } });
      }
      if (request.method === "DELETE") { await env.BACKUPS.delete(key); return json({ deleted: true }, 200, origin, env); }
      return json({ code: "METHOD_NOT_ALLOWED" }, 405, origin, env);
    } catch (error) {
      if (["UNAUTHENTICATED", "INVALID_TOKEN", "TOKEN_PROJECT_MISMATCH"].includes(error.message)) return json({ code: error.message }, 401, origin, env);
      if (error.message === "GUEST_UNSUPPORTED") return json({ code: error.message }, 403, origin, env);
      console.error("backup worker error", error);
      return json({ code: error.message === "WORKER_CONFIG_MISSING" ? error.message : "BACKUP_SERVICE_UNAVAILABLE" }, 500, origin, env);
    }
  }
};
