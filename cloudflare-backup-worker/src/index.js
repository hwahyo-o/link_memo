const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certificates = { expires:0, value:null };

function json(value, status=200, origin="") {
  return new Response(JSON.stringify(value), { status, headers:{ "content-type":"application/json", ...cors(origin) } });
}
function cors(origin) {
  const allowed = (globalThis.__env?.ALLOWED_ORIGINS || "").split(",").map(x=>x.trim());
  return allowed.includes(origin) ? { "access-control-allow-origin":origin, "vary":"Origin", "access-control-allow-headers":"authorization,content-type", "access-control-allow-methods":"GET,POST,DELETE,OPTIONS" } : {};
}
function decode(value) { return JSON.parse(atob(value.replace(/-/g,"+").replace(/_/g,"/"))); }
function bytes(value) { return new TextEncoder().encode(value); }

async function getCertificates() {
  if (certificates.value && Date.now() < certificates.expires) return certificates.value;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error("FIREBASE_CERT_FETCH_FAILED");
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  certificates = { value: await response.json(), expires:Date.now()+maxAge*1000 };
  return certificates.value;
}
async function verifyToken(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/,"");
  if (!token) throw new Error("UNAUTHENTICATED");
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  const header = decode(encodedHeader), claims = decode(encodedClaims);
  if (!encodedSignature || header.alg !== "RS256" || !header.kid || claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` || !claims.sub || claims.sub.length > 128 || claims.exp * 1000 < Date.now() || !claims.iat || claims.iat * 1000 > Date.now() + 60_000) throw new Error("INVALID_TOKEN");
  const cert = (await getCertificates())[header.kid];
  if (!cert) throw new Error("INVALID_TOKEN");
  const key = await crypto.subtle.importKey("spki", pemToArrayBuffer(cert), { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0));
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, bytes(`${encodedHeader}.${encodedClaims}`))) throw new Error("INVALID_TOKEN");
  return claims.sub;
}
function pemToArrayBuffer(pem) {
  const raw = atob(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g,""));
  return Uint8Array.from(raw, c=>c.charCodeAt(0)).buffer;
}
function objectKey(uid, backupId) { return `users/${uid}/${backupId}.json`; }
function validId(id) { return /^backup_[a-z0-9_-]{8,100}$/i.test(id || ""); }

export default {
 async fetch(request, env) {
  globalThis.__env = env;
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors(origin)});
  if (origin && !cors(origin)["access-control-allow-origin"]) return json({code:"ORIGIN_NOT_ALLOWED"},403,origin);
  try {
   const uid = await verifyToken(request,env);
   const url = new URL(request.url);
   if (request.method === "POST" && url.pathname === "/v1/backups") {
    const body = await request.json();
    if (!validId(body.backupId) || body.userId !== uid || body.schemaVersion !== 1) return json({code:"INVALID_BACKUP"},400,origin);
    const encoded = JSON.stringify(body);
    if (encoded.length > 5_000_000) return json({code:"BACKUP_TOO_LARGE"},413,origin);
    await env.BACKUPS.put(objectKey(uid,body.backupId),encoded,{httpMetadata:{contentType:"application/json"}});
    return json({backupId:body.backupId,size:encoded.length},201,origin);
   }
   const match = url.pathname.match(/^\/v1\/backups\/([^/]+)$/);
   if (!match || !validId(match[1])) return json({code:"NOT_FOUND"},404,origin);
   const key=objectKey(uid,match[1]);
   if (request.method === "GET") {
    const object=await env.BACKUPS.get(key); if(!object) return json({code:"BACKUP_NOT_FOUND"},404,origin);
    return new Response(object.body,{headers:{"content-type":"application/json",...cors(origin)}});
   }
   if (request.method === "DELETE") { await env.BACKUPS.delete(key); return json({deleted:true},200,origin); }
   return json({code:"METHOD_NOT_ALLOWED"},405,origin);
  } catch(error) {
   if (error.message === "UNAUTHENTICATED" || error.message === "INVALID_TOKEN") {
     return json({code:error.message},401,origin);
   }
   console.error("backup worker error", error);
   return json({code:"BACKUP_SERVICE_UNAVAILABLE"},500,origin);
  }
 }
};