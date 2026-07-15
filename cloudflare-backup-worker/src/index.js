const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
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
async function getJwks() {
  if (jwksCache.keys.length && Date.now() < jwksCache.expires) return jwksCache.keys;
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
  const header = decodeJson(encodedHeader), claims = decodeJson(encodedClaims), now = Date.now();
  if (header.alg !== "RS256" || !header.kid || !claims.sub || claims.sub.length > 128) throw new Error("INVALID_TOKEN");
  if (claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error("TOKEN_PROJECT_MISMATCH");
  if (!claims.exp || claims.exp * 1000 < now || !claims.iat || claims.iat * 1000 > now + 60_000) throw new Error("INVALID_TOKEN");
  const jwk = (await getJwks()).find(key => key.kid === header.kid);
  if (!jwk) throw new Error("INVALID_TOKEN");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  if (!valid) throw new Error("INVALID_TOKEN");
  return claims.sub;
}
function objectKey(uid, backupId) { return `users/${uid}/${backupId}.json`; }
function validId(id) { return /^backup_[a-z0-9_-]{8,100}$/i.test(id || ""); }
export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, env) });
    if (origin && !cors(origin, env)["access-control-allow-origin"]) return json({ code: "ORIGIN_NOT_ALLOWED" }, 403, origin, env);
    try {
      const uid = await verifyToken(request, env), url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/backups") {
        const body = await request.json();
        if (!validId(body.backupId) || body.userId !== uid || body.schemaVersion !== 1) return json({ code: "INVALID_BACKUP" }, 400, origin, env);
        const encoded = JSON.stringify(body);
        if (encoded.length > 5_000_000) return json({ code: "BACKUP_TOO_LARGE" }, 413, origin, env);
        await env.BACKUPS.put(objectKey(uid, body.backupId), encoded, { httpMetadata: { contentType: "application/json" } });
        return json({ backupId: body.backupId, size: encoded.length }, 201, origin, env);
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
      console.error("backup worker error", error);
      return json({ code: error.message === "WORKER_CONFIG_MISSING" ? error.message : "BACKUP_SERVICE_UNAVAILABLE" }, 500, origin, env);
    }
  }
};
