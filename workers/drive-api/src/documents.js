const DOCUMENT_FOLDER_NAME = "link-memo-files";
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 2 * 1024 * 1024;
const ALLOWED_DOCUMENTS = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
]);
const SESSION_URL_PATTERN = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/;

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { status });
}

function cleanName(value) {
  if (typeof value !== "string") fail("DOCUMENT_NAME_REQUIRED");
  const name = value.normalize("NFC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 180);
  if (!name) fail("DOCUMENT_NAME_REQUIRED");
  return name;
}

function documentType(name, mimeType, size) {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ALLOWED_DOCUMENTS.get(extension) !== mimeType) fail("UNSUPPORTED_DOCUMENT_TYPE", 415);
  if (!Number.isInteger(size) || size < 1) fail("DOCUMENT_SIZE_INVALID");
  if (size > MAX_DOCUMENT_BYTES) fail("DOCUMENT_TOO_LARGE", 413);
  return { extension, mimeType };
}

async function documentFolder(user, env, accessToken, driveFetch) {
  const existing = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT folder_id FROM drive_document_storage WHERE uid = ?"
  ).bind(user.uid).first();
  if (existing?.folder_id) return existing.folder_id;

  const query = encodeURIComponent(`name = '${DOCUMENT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const listed = await (await driveFetch(accessToken, `?q=${query}&fields=files(id)`)).json();
  let folderId = listed.files?.[0]?.id;
  if (!folderId) {
    const created = await (await driveFetch(accessToken, "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: DOCUMENT_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    })).json();
    folderId = created.id;
  }
  if (!folderId) fail("DRIVE_FOLDER_CREATE_FAILED", 502);
  await env.DRIVE_CREDENTIALS.prepare(
    "INSERT INTO drive_document_storage (uid, folder_id, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(uid) DO UPDATE SET folder_id = excluded.folder_id, updated_at = unixepoch()"
  ).bind(user.uid, folderId).run();
  return folderId;
}

async function startUpload(request, user, env, deps) {
  const body = await request.json();
  await env.DRIVE_CREDENTIALS.prepare(
    "DELETE FROM drive_document_uploads WHERE uid = ? AND created_at < unixepoch() - 86400"
  ).bind(user.uid).run();
  const name = cleanName(body?.name);
  const { mimeType } = documentType(name, body?.mimeType, body?.size);
  const attachmentId = typeof body?.attachmentId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(body.attachmentId)
    ? body.attachmentId
    : fail("ATTACHMENT_ID_INVALID");
  const checksumSha256 = typeof body?.checksumSha256 === "string" && /^[a-f0-9]{64}$/i.test(body.checksumSha256)
    ? body.checksumSha256.toLowerCase()
    : fail("CHECKSUM_REQUIRED");
  const existingFile = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT file_id, name, mime_type, size_bytes, checksum_sha256, deleted_at FROM drive_document_files WHERE uid = ? AND attachment_id = ?"
  ).bind(user.uid, attachmentId).first();
  if (existingFile) {
    if (existingFile.checksum_sha256 !== checksumSha256 || existingFile.size_bytes !== body.size || existingFile.mime_type !== mimeType) fail("ATTACHMENT_ID_CONFLICT", 409);
    return deps.json({ completed: true, deleted: Boolean(existingFile.deleted_at), file: { id: existingFile.file_id, name: existingFile.name, mimeType: existingFile.mime_type, size: existingFile.size_bytes, checksumSha256 } });
  }
  const existingUpload = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT id, total_bytes, mime_type, checksum_sha256, next_offset FROM drive_document_uploads WHERE uid = ? AND attachment_id = ?"
  ).bind(user.uid, attachmentId).first();
  if (existingUpload) {
    if (existingUpload.checksum_sha256 !== checksumSha256 || existingUpload.total_bytes !== body.size || existingUpload.mime_type !== mimeType) fail("ATTACHMENT_ID_CONFLICT", 409);
    return deps.json({ uploadId: existingUpload.id, chunkBytes: CHUNK_BYTES, nextOffset: existingUpload.next_offset });
  }
  const accessToken = await deps.driveAccessToken(user.uid, env);
  const folderId = await documentFolder(user, env, accessToken, deps.driveFetch);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(body.size)
    },
    body: JSON.stringify({ name, mimeType, parents: [folderId] })
  });
  if (!response.ok) fail(`DRIVE_API_${response.status}`, response.status);
  const sessionUrl = response.headers.get("Location") || "";
  if (!SESSION_URL_PATTERN.test(sessionUrl)) fail("DRIVE_UPLOAD_SESSION_INVALID", 502);
  const encrypted = await deps.encrypt(sessionUrl, env);
  const uploadId = crypto.randomUUID();
  await env.DRIVE_CREDENTIALS.prepare(
    `INSERT INTO drive_document_uploads
      (id, uid, attachment_id, name, mime_type, total_bytes, checksum_sha256, session_ciphertext, session_iv, next_offset, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch())`
  ).bind(uploadId, user.uid, attachmentId, name, mimeType, body.size, checksumSha256, encrypted.ciphertext, encrypted.iv).run();
  return deps.json({ uploadId, chunkBytes: CHUNK_BYTES, nextOffset: 0 }, 201);
}

function parseRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || "");
  if (!match) fail("CONTENT_RANGE_REQUIRED");
  const [, start, end, total] = match.map(Number);
  if (start < 0 || end < start || total < 1) fail("CONTENT_RANGE_INVALID");
  return { start, end, total };
}

async function uploadChunk(request, user, env, uploadId, deps) {
  const record = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT attachment_id, name, mime_type, total_bytes, checksum_sha256, session_ciphertext, session_iv, next_offset FROM drive_document_uploads WHERE id = ? AND uid = ?"
  ).bind(uploadId, user.uid).first();
  if (!record) fail("UPLOAD_SESSION_NOT_FOUND", 404);
  const range = parseRange(request.headers.get("Content-Range"));
  const declaredLength = request.headers.get("Content-Length");
  if (range.total !== record.total_bytes || (declaredLength && range.end - range.start + 1 !== Number(declaredLength))) {
    fail("CONTENT_RANGE_INVALID");
  }
  const chunk = await request.arrayBuffer();
  if (chunk.byteLength !== range.end - range.start + 1 || chunk.byteLength > 8 * 1024 * 1024) fail("CHUNK_SIZE_INVALID", 413);
  if (range.start % CHUNK_BYTES !== 0 || (range.end + 1 < range.total && chunk.byteLength % (256 * 1024) !== 0)) {
    fail("CHUNK_ALIGNMENT_INVALID");
  }
  if (range.end >= range.total) fail("CONTENT_RANGE_INVALID");

  const sessionUrl = await deps.decrypt({ refresh_token: record.session_ciphertext, iv: record.session_iv }, env);
  if (!SESSION_URL_PATTERN.test(sessionUrl)) fail("DRIVE_UPLOAD_SESSION_INVALID", 500);
  const accessToken = await deps.driveAccessToken(user.uid, env);
  const statusResponse = await fetch(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Range": `bytes */${record.total_bytes}` }
  });
  if (statusResponse.status === 404 || statusResponse.status === 410) {
    await env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_document_uploads WHERE id = ? AND uid = ?").bind(uploadId, user.uid).run();
    fail("UPLOAD_SESSION_EXPIRED", 410);
  }
  if (statusResponse.status !== 308 && !statusResponse.ok) fail(`DRIVE_API_${statusResponse.status}`, statusResponse.status);
  if (statusResponse.ok) {
    return completeUpload(user, env, uploadId, record, await statusResponse.json(), deps);
  }
  const acceptedRange = statusResponse.headers.get("Range");
  const remoteOffset = acceptedRange ? Number(acceptedRange.match(/-(\d+)$/)?.[1]) + 1 : 0;
  if (!Number.isInteger(remoteOffset) || remoteOffset < 0 || remoteOffset > record.total_bytes) fail("DRIVE_UPLOAD_STATUS_INVALID", 502);
  if (remoteOffset !== range.start) {
    return deps.json({ uploadId, nextOffset: remoteOffset, completed: false });
  }

  if (range.start === 0) {
    const signature = new Uint8Array(chunk.slice(0, 8));
    const valid = record.mime_type === "application/pdf"
      ? new TextDecoder().decode(signature.slice(0, 5)) === "%PDF-"
      : signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04;
    if (!valid) fail("DOCUMENT_CONTENT_MISMATCH", 415);
  }

  const sessionResponse = await fetch(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": String(chunk.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${range.total}`,
      "Content-Type": record.mime_type
    },
    body: chunk
  });
  if (sessionResponse.status === 308) {
    const rangeHeader = sessionResponse.headers.get("Range");
    const nextOffset = rangeHeader ? Number(rangeHeader.match(/-(\d+)$/)?.[1]) + 1 : 0;
    await env.DRIVE_CREDENTIALS.prepare(
      "UPDATE drive_document_uploads SET next_offset = ? WHERE id = ? AND uid = ?"
    ).bind(nextOffset, uploadId, user.uid).run();
    return deps.json({ uploadId, nextOffset, completed: false });
  }
  if (!sessionResponse.ok) fail(`DRIVE_API_${sessionResponse.status}`, sessionResponse.status);

  return completeUpload(user, env, uploadId, record, await sessionResponse.json(), deps);
}

async function completeUpload(user, env, uploadId, record, file, deps) {
  if (!file?.id) fail("DRIVE_UPLOAD_RESPONSE_INVALID", 502);
  const accessToken = await deps.driveAccessToken(user.uid, env);
  const stored = await deps.driveFetch(accessToken, `/${encodeURIComponent(file.id)}?alt=media`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await stored.arrayBuffer()));
  const checksumSha256 = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (checksumSha256 !== record.checksum_sha256) {
    await deps.driveFetch(accessToken, `/${encodeURIComponent(file.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true })
    });
    await env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_document_uploads WHERE id = ? AND uid = ?").bind(uploadId, user.uid).run();
    fail("DOCUMENT_CHECKSUM_MISMATCH", 502);
  }
  await env.DRIVE_CREDENTIALS.batch([
    env.DRIVE_CREDENTIALS.prepare(
      "INSERT OR REPLACE INTO drive_document_files (file_id, uid, attachment_id, name, mime_type, size_bytes, checksum_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())"
    ).bind(file.id, user.uid, record.attachment_id, file.name || record.name, record.mime_type, record.total_bytes, checksumSha256),
    env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_document_uploads WHERE id = ? AND uid = ?").bind(uploadId, user.uid)
  ]);
  return deps.json({ uploadId, completed: true, file: { id: file.id, name: file.name || record.name, mimeType: record.mime_type, size: record.total_bytes, checksumSha256, webViewLink: file.webViewLink || null } });
}

async function uploadStatus(user, env, uploadId, deps) {
  const record = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT attachment_id, name, mime_type, total_bytes, checksum_sha256, session_ciphertext, session_iv FROM drive_document_uploads WHERE id = ? AND uid = ?"
  ).bind(uploadId, user.uid).first();
  if (!record) fail("UPLOAD_SESSION_NOT_FOUND", 404);
  const sessionUrl = await deps.decrypt({ refresh_token: record.session_ciphertext, iv: record.session_iv }, env);
  if (!SESSION_URL_PATTERN.test(sessionUrl)) fail("DRIVE_UPLOAD_SESSION_INVALID", 500);
  const accessToken = await deps.driveAccessToken(user.uid, env);
  const response = await fetch(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Range": `bytes */${record.total_bytes}` }
  });
  if (response.status === 404 || response.status === 410) {
    await env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_document_uploads WHERE id = ? AND uid = ?").bind(uploadId, user.uid).run();
    fail("UPLOAD_SESSION_EXPIRED", 410);
  }
  if (response.status === 308) {
    const acceptedRange = response.headers.get("Range");
    const nextOffset = acceptedRange ? Number(acceptedRange.match(/-(\d+)$/)?.[1]) + 1 : 0;
    await env.DRIVE_CREDENTIALS.prepare(
      "UPDATE drive_document_uploads SET next_offset = ? WHERE id = ? AND uid = ?"
    ).bind(nextOffset, uploadId, user.uid).run();
    return deps.json({ uploadId, nextOffset, completed: false });
  }
  if (!response.ok) fail(`DRIVE_API_${response.status}`, response.status);
  return completeUpload(user, env, uploadId, record, await response.json(), deps);
}

async function removeUpload(user, env, uploadId, deps) {
  const record = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT session_ciphertext, session_iv FROM drive_document_uploads WHERE id = ? AND uid = ?"
  ).bind(uploadId, user.uid).first();
  if (!record) return new Response(null, { status: 204 });
  const sessionUrl = await deps.decrypt({ refresh_token: record.session_ciphertext, iv: record.session_iv }, env);
  if (SESSION_URL_PATTERN.test(sessionUrl)) await fetch(sessionUrl, { method: "DELETE", redirect: "manual" }).catch(() => {});
  await env.DRIVE_CREDENTIALS.prepare("DELETE FROM drive_document_uploads WHERE id = ? AND uid = ?").bind(uploadId, user.uid).run();
  return new Response(null, { status: 204 });
}

async function readDocument(user, env, fileId, deps) {
  const owned = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT mime_type, name FROM drive_document_files WHERE file_id = ? AND uid = ? AND deleted_at IS NULL"
  ).bind(fileId, user.uid).first();
  if (!owned) fail("DOCUMENT_NOT_FOUND", 404);
  const accessToken = await deps.driveAccessToken(user.uid, env);
  const response = await deps.driveFetch(accessToken, `/${encodeURIComponent(fileId)}?alt=media`);
  return new Response(response.body, {
    headers: {
      "Content-Type": owned.mime_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(owned.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-site",
      Vary: "Authorization, Origin"
    }
  });
}

async function deleteDocument(user, env, fileId, deps) {
  const owned = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT file_id, deleted_at FROM drive_document_files WHERE file_id = ? AND uid = ?"
  ).bind(fileId, user.uid).first();
  if (!owned) fail("DOCUMENT_NOT_FOUND", 404);
  if (owned.deleted_at) return new Response(null, { status: 204 });
  const accessToken = await deps.driveAccessToken(user.uid, env);
  await deps.driveFetch(accessToken, `/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true })
  });
  await env.DRIVE_CREDENTIALS.prepare("UPDATE drive_document_files SET deleted_at = unixepoch() WHERE file_id = ? AND uid = ?").bind(fileId, user.uid).run();
  return new Response(null, { status: 204 });
}

async function restoreDocument(user, env, fileId, deps) {
  const owned = await env.DRIVE_CREDENTIALS.prepare(
    "SELECT file_id, deleted_at FROM drive_document_files WHERE file_id = ? AND uid = ?"
  ).bind(fileId, user.uid).first();
  if (!owned) fail("DOCUMENT_NOT_FOUND", 404);
  if (!owned.deleted_at) return deps.json({ restored: true, fileId });
  const accessToken = await deps.driveAccessToken(user.uid, env);
  await deps.driveFetch(accessToken, `/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: false })
  });
  await env.DRIVE_CREDENTIALS.prepare("UPDATE drive_document_files SET deleted_at = NULL WHERE file_id = ? AND uid = ?").bind(fileId, user.uid).run();
  return deps.json({ restored: true, fileId });
}

export async function handleDocumentRequest(request, user, env, path, deps) {
  const parts = path.split("/").filter(Boolean);
  if (request.method === "POST" && path === "documents/uploads") return startUpload(request, user, env, deps);
  if (parts[0] !== "documents" || parts[1] !== "uploads" || !parts[2]) {
    if (request.method === "GET" && parts[0] === "documents" && parts[1]) return readDocument(user, env, parts[1], deps);
    if (request.method === "DELETE" && parts[0] === "documents" && parts[1]) return deleteDocument(user, env, parts[1], deps);
    if (request.method === "POST" && parts[0] === "documents" && parts[1] && parts[2] === "restore" && parts.length === 3) return restoreDocument(user, env, parts[1], deps);
    return null;
  }
  const uploadId = parts[2];
  if (request.method === "GET" && parts.length === 3) return uploadStatus(user, env, uploadId, deps);
  if (request.method === "PUT" && parts.length === 3) return uploadChunk(request, user, env, uploadId, deps);
  if (request.method === "DELETE" && parts.length === 3) return removeUpload(user, env, uploadId, deps);
  return null;
}
