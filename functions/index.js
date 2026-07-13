import crypto from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";

admin.initializeApp();
const db = admin.firestore();
const DRIVE_CLIENT_ID = defineSecret("DRIVE_CLIENT_ID");
const DRIVE_CLIENT_SECRET = defineSecret("DRIVE_CLIENT_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("DRIVE_TOKEN_ENCRYPTION_KEY");
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "link-memo-img";

function keyFromSecret() {
  return crypto.createHash("sha256").update(TOKEN_ENCRYPTION_KEY.value()).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") };
}
function decrypt(value) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromSecret(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.body, "base64")), decipher.final()]).toString("utf8");
}
async function firebaseUser(req) {
  const header = req.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) throw Object.assign(new Error("UNAUTHENTICATED"), { status: 401 });
  return admin.auth().verifyIdToken(header.slice(7));
}
function oauthClient() {
  return new OAuth2Client(DRIVE_CLIENT_ID.value(), DRIVE_CLIENT_SECRET.value(), process.env.DRIVE_OAUTH_REDIRECT_URI || "postmessage");
}
async function driveClientFor(uid) {
  const credential = await db.doc(`driveCredentials/${uid}`).get();
  if (!credential.exists) throw Object.assign(new Error("DRIVE_NOT_CONNECTED"), { status: 403 });
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(credential.data().refreshToken) });
  const token = await client.getAccessToken();
  if (!token.token) throw Object.assign(new Error("DRIVE_TOKEN_REFRESH_FAILED"), { status: 401 });
  return token.token;
}
async function driveFetch(token, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw Object.assign(new Error(`DRIVE_API_${response.status}`), { status: response.status });
  return response;
}
async function ensureFolder(token) {
  const q = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const list = await (await driveFetch(token, `?q=${q}&fields=files(id)`)).json();
  if (list.files?.[0]?.id) return list.files[0].id;
  return (await (await driveFetch(token, "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) })).json()).id;
}
function sendError(res, error) {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "INTERNAL_ERROR" });
}
export const driveApi = onRequest({ secrets: [DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY], cors: true, region: "asia-northeast3" }, async (req, res) => {
  try {
    const user = await firebaseUser(req);
    const path = req.path.replace(/^\/+/, "");
    if (req.method === "POST" && path === "connect") {
      const client = oauthClient();
      const { tokens } = await client.getToken(req.body.authorizationCode);
      if (!tokens.refresh_token || !tokens.id_token) throw Object.assign(new Error("DRIVE_OFFLINE_ACCESS_REQUIRED"), { status: 400 });
      const verified = await client.verifyIdToken({ idToken: tokens.id_token, audience: DRIVE_CLIENT_ID.value() });
      const driveEmail = verified.getPayload().email?.toLowerCase();
      if (!driveEmail || driveEmail !== String(user.email || "").toLowerCase()) throw Object.assign(new Error("DRIVE_ACCOUNT_MISMATCH"), { status: 403 });
      client.setCredentials(tokens);
      const folderId = await ensureFolder(tokens.access_token);
      await db.doc(`driveCredentials/${user.uid}`).set({ refreshToken: encrypt(tokens.refresh_token), driveEmail, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return res.json({ permissionGranted: true, folderId, connectedAt: Date.now() });
    }
    const token = await driveClientFor(user.uid);
    if (req.method === "GET" && path === "session") return res.json({ active: true });
    if (req.method === "POST" && path === "upload") {
      const folderId = await ensureFolder(token);
      const name = decodeURIComponent(req.get("X-Link-Memo-File-Name") || `image-${Date.now()}`);
      const boundary = `link_memo_${crypto.randomUUID()}`;
      const metadata = { name, parents: [folderId], mimeType: req.get("Content-Type") || "application/octet-stream", appProperties: { linkMemo: "true" } };
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`), req.rawBody, Buffer.from(`\r\n--${boundary}--`)]);
      const upload = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
      if (!upload.ok) throw Object.assign(new Error(`DRIVE_UPLOAD_${upload.status}`), { status: upload.status });
      return res.json(await upload.json());
    }
    const imageMatch = path.match(/^image\/([^/]+)$/);
    if (imageMatch && req.method === "GET") {
      const image = await driveFetch(token, `/${encodeURIComponent(imageMatch[1])}?alt=media`);
      res.set("Cache-Control", "private, max-age=300");
      res.set("Content-Type", image.headers.get("content-type") || "application/octet-stream");
      return res.send(Buffer.from(await image.arrayBuffer()));
    }
    if (imageMatch && req.method === "DELETE") {
      await driveFetch(token, `/${encodeURIComponent(imageMatch[1])}`, { method: "DELETE" });
      return res.status(204).end();
    }
    return res.status(404).json({ error: "NOT_FOUND" });
  } catch (error) { return sendError(res, error); }
});
