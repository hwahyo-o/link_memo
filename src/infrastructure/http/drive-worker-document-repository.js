const DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;

function sha256Hex(bytes) {
    return crypto.subtle.digest("SHA-256", bytes).then(digest =>
        [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
    );
}

function createHttpError(body, status) {
    const error = new Error(body?.error || `DRIVE_DOCUMENT_FAILED_${status}`);
    error.status = status;
    return error;
}

export function createDriveWorkerDocumentRepository({
    auth,
    queue,
    driveCodeProvider,
    baseUrl = import.meta.env.VITE_DRIVE_WORKER_URL
} = {}) {
    async function request(path, options = {}, forceRefresh = false, expectedUserId = null) {
        const user = auth?.currentUser;
        if (!user) throw new Error("DRIVE_WORKER_AUTH_REQUIRED");
        if (expectedUserId && user.uid !== expectedUserId) throw new Error("AUTH_SESSION_CHANGED");
        const idToken = await user.getIdToken(forceRefresh);
        if (expectedUserId && auth?.currentUser?.uid !== expectedUserId) throw new Error("AUTH_SESSION_CHANGED");
        try {
            return await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
                ...options,
                headers: { Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
            });
        } catch (cause) {
            throw Object.assign(new Error("DRIVE_WORKER_UNREACHABLE"), { cause });
        }
    }

    async function authorizedFetch(path, options = {}, expectedUserId = null) {
        if (!baseUrl) throw new Error("DRIVE_WORKER_URL_MISSING");
        let response = await request(path, options, false, expectedUserId);
        if (response.status === 401) response = await request(path, options, true, expectedUserId);
        if (!response.ok) {
            let body = null;
            try { body = await response.json(); } catch { /* response body may be empty */ }
            throw createHttpError(body, response.status);
        }
        return response;
    }

    async function readJson(path, options, expectedUserId = null) {
        const response = await authorizedFetch(path, options, expectedUserId);
        try {
            return await response.json();
        } catch (cause) {
            throw Object.assign(new Error("DRIVE_DOCUMENT_RESPONSE_INVALID"), { cause });
        }
    }

    async function startUpload(attachment, checksumSha256, userId) {
        return readJson("/documents/uploads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                attachmentId: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.sizeBytes,
                checksumSha256
            })
        }, userId);
    }

    async function getUploadStatus(uploadId, userId) {
        return readJson(`/documents/uploads/${encodeURIComponent(uploadId)}`, {}, userId);
    }

    async function uploadChunk(uploadId, file, start, chunkBytes, userId) {
        const end = Math.min(start + chunkBytes, file.size) - 1;
        const chunk = await file.slice(start, end + 1).arrayBuffer();
        return readJson(`/documents/uploads/${encodeURIComponent(uploadId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Range": `bytes ${start}-${end}/${file.size}`
            },
            body: chunk
        }, userId);
    }

    async function finishQueueRecord(userId, attachmentId, result, checksumSha256) {
        if (!result?.file?.id || result.file.checksumSha256 !== checksumSha256) {
            throw new Error("DOCUMENT_UPLOAD_RECEIPT_INVALID");
        }
        await queue.markUploaded(userId, attachmentId, {
            providerFileId: result.file.id,
            sha256: result.file.checksumSha256
        });
        return result.file;
    }

    return {
        async connect() {
            if (!driveCodeProvider?.requestCode) throw new Error("DRIVE_OAUTH_PROVIDER_REQUIRED");
            const user = auth?.currentUser;
            if (!user) throw new Error("DRIVE_WORKER_AUTH_REQUIRED");
            const userId = user.uid;
            const authorizationCode = await driveCodeProvider.requestCode({ loginHint: user.email || "" });
            if (auth?.currentUser?.uid !== userId) throw new Error("AUTH_SESSION_CHANGED");
            return readJson("/connect", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Requested-With": "link-memo"
                },
                body: JSON.stringify({ authorizationCode })
            }, userId);
        },

        async restoreSession() {
            return readJson("/session");
        },

        async uploadPending(userId, attachmentId) {
            const ownerId = String(userId || "").trim();
            if (!ownerId) throw new Error("ATTACHMENT_QUEUE_USER_REQUIRED");
            if (auth?.currentUser?.uid !== ownerId) throw new Error("ATTACHMENT_QUEUE_USER_MISMATCH");
            const records = await queue.listPending(ownerId);
            const attachment = records.find(record => record.id === attachmentId);
            if (!attachment) throw new Error("ATTACHMENT_QUEUE_ITEM_NOT_FOUND");
            const file = await queue.loadFile(ownerId, attachmentId);
            if (!file) throw new Error("ATTACHMENT_QUEUE_FILE_MISSING");

            const checksumSha256 = await sha256Hex(await file.arrayBuffer());
            await queue.updateState(ownerId, attachmentId, "uploading");
            let uploadId = attachment.uploadId || null;
            let nextOffset = 0;

            try {
                if (uploadId) {
                    try {
                        const status = await getUploadStatus(uploadId, ownerId);
                        if (status.completed) {
                            if (status.deleted) throw new Error("DOCUMENT_ALREADY_TRASHED");
                            return await finishQueueRecord(ownerId, attachmentId, status, checksumSha256);
                        }
                        nextOffset = status.nextOffset;
                    } catch (error) {
                        if (error.status !== 410 && error.status !== 404) throw error;
                        uploadId = null;
                        await queue.updateUploadSession(ownerId, attachmentId, { uploadId: null, nextOffset: 0 });
                    }
                }

                if (!uploadId) {
                    const session = await startUpload(attachment, checksumSha256, ownerId);
                    if (session.completed) {
                        if (session.deleted) throw new Error("DOCUMENT_ALREADY_TRASHED");
                        return await finishQueueRecord(ownerId, attachmentId, session, checksumSha256);
                    }
                    uploadId = session.uploadId;
                    nextOffset = session.nextOffset || 0;
                    if (!uploadId) throw new Error("DOCUMENT_UPLOAD_SESSION_INVALID");
                    await queue.updateUploadSession(ownerId, attachmentId, { uploadId, nextOffset });
                }

                const chunkBytes = DEFAULT_CHUNK_BYTES;
                while (nextOffset < file.size) {
                    const result = await uploadChunk(uploadId, file, nextOffset, chunkBytes, ownerId);
                    if (result.completed) return await finishQueueRecord(ownerId, attachmentId, result, checksumSha256);
                    const updatedOffset = Number(result.nextOffset);
                    if (!Number.isSafeInteger(updatedOffset) || updatedOffset <= nextOffset || updatedOffset > file.size) {
                        throw new Error("DOCUMENT_UPLOAD_OFFSET_INVALID");
                    }
                    nextOffset = updatedOffset;
                    await queue.updateUploadSession(ownerId, attachmentId, { uploadId, nextOffset });
                }

                const status = await getUploadStatus(uploadId, ownerId);
                if (status.completed) return await finishQueueRecord(ownerId, attachmentId, status, checksumSha256);
                throw new Error("DOCUMENT_UPLOAD_INCOMPLETE");
            } catch (error) {
                await queue.markAttempt(ownerId, attachmentId, error.message || "UPLOAD_FAILED");
                throw error;
            }
        },

        async download(fileId) {
            const response = await authorizedFetch(`/documents/${encodeURIComponent(fileId)}`);
            return response.blob();
        },

        async remove(fileId) {
            if (!fileId) return;
            await authorizedFetch(`/documents/${encodeURIComponent(fileId)}`, { method: "DELETE" });
        },

        async restore(fileId) {
            if (!fileId) throw new Error("DOCUMENT_FILE_ID_REQUIRED");
            return readJson(`/documents/${encodeURIComponent(fileId)}/restore`, { method: "POST" });
        },

        async cancelUpload(userId, attachmentId) {
            if (auth?.currentUser?.uid !== String(userId || "").trim()) throw new Error("ATTACHMENT_QUEUE_USER_MISMATCH");
            const records = await queue.listPending(userId);
            const attachment = records.find(record => record.id === attachmentId);
            if (!attachment?.uploadId) return;
            await authorizedFetch(`/documents/uploads/${encodeURIComponent(attachment.uploadId)}`, { method: "DELETE" });
            await queue.updateUploadSession(userId, attachmentId, { uploadId: null, nextOffset: 0 });
            await queue.updateState(userId, attachmentId, "queued");
        }
    };
}
