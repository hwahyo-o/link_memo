import {
    normalizeDocumentAttachment,
    validateDocumentAttachment
} from "../../domain/second-brain/attachment-policy.js";

const DATABASE_NAME = "second_brain_attachments";
const DATABASE_VERSION = 1;
const QUEUE_STORE = "uploadQueue";
const USER_INDEX = "byUserId";
const UPLOAD_STATES = new Set(["queued", "uploading", "uploaded", "failed"]);

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (database.objectStoreNames.contains(QUEUE_STORE)) return;
            const store = database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
            store.createIndex(USER_INDEX, "userId", { unique: false });
        };

        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => database.close();
            resolve(database);
        };
        request.onerror = () => reject(request.error);
    });
}

async function transact(mode, operation) {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(QUEUE_STORE, mode);
        let result;

        transaction.oncomplete = () => {
            database.close();
            resolve(result && typeof result === "object" && "result" in result ? result.result : result);
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error || new Error("ATTACHMENT_QUEUE_ABORTED"));
        };

        try {
            result = operation(transaction.objectStore(QUEUE_STORE));
        } catch (error) {
            transaction.abort();
            database.close();
            reject(error);
        }
    });
}

function requireUserId(userId) {
    const value = String(userId || "").trim();
    if (!value) throw new Error("ATTACHMENT_QUEUE_USER_REQUIRED");
    return value;
}

function requireAttachmentId(id) {
    const value = String(id || "").trim();
    if (!value || value.length > 128) throw new Error("ATTACHMENT_QUEUE_ID_INVALID");
    return value;
}

function withoutFile(record) {
    if (!record) return null;
    const { file, userId, ...metadata } = record;
    return metadata;
}

function updateOwnedRecord(userId, attachmentId, update) {
    return openDatabase().then(database => new Promise((resolve, reject) => {
        const transaction = database.transaction(QUEUE_STORE, "readwrite");
        const store = transaction.objectStore(QUEUE_STORE);
        let result = null;

        transaction.oncomplete = () => {
            database.close();
            resolve(result);
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error || new Error("ATTACHMENT_QUEUE_ABORTED"));
        };

        const request = store.get(attachmentId);
        request.onsuccess = () => {
            const current = request.result;
            if (!current || current.userId !== userId) return;

            const next = update(current);
            if (!next) {
                store.delete(attachmentId);
                result = true;
                return;
            }

            store.put(next);
            result = withoutFile(next);
        };
    }));
}

export function createIndexedDbAttachmentQueue() {
    return {
        async savePending({ userId, attachment, file }) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(attachment?.id);
            const validation = validateDocumentAttachment(file);
            if (!validation.ok) throw new Error(validation.error);

            const normalized = normalizeDocumentAttachment({
                ...attachment,
                ...validation.value,
                uploadState: "queued",
                provider: "drive",
                providerFileId: null,
                sha256: null
            });
            const record = {
                ...normalized,
                userId: ownerId,
                file,
                retryCount: 0,
                lastErrorCode: null,
                queuedAt: Date.now(),
                updatedAt: Date.now()
            };

            await transact("readwrite", store => store.put(record));
            return withoutFile(record);
        },

        async listPending(userId) {
            const ownerId = requireUserId(userId);
            const records = await transact("readonly", store => store.index(USER_INDEX).getAll(ownerId));
            return records.map(withoutFile);
        },

        async loadFile(userId, id) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            const record = await transact("readonly", store => store.get(attachmentId));
            if (!record || record.userId !== ownerId) return null;
            return record.file || null;
        },

        updateState(userId, id, state) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            if (!UPLOAD_STATES.has(state)) throw new Error("ATTACHMENT_QUEUE_STATE_INVALID");
            return updateOwnedRecord(ownerId, attachmentId, current => ({
                ...current,
                uploadState: state,
                lastErrorCode: null,
                updatedAt: Date.now()
            }));
        },

        markAttempt(userId, id, errorCode = "UPLOAD_FAILED") {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            return updateOwnedRecord(ownerId, attachmentId, current => ({
                ...current,
                uploadState: "failed",
                retryCount: Number(current.retryCount || 0) + 1,
                lastErrorCode: String(errorCode || "UPLOAD_FAILED").slice(0, 120),
                updatedAt: Date.now()
            }));
        },

        async removePending(userId, id) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            return Boolean(await updateOwnedRecord(ownerId, attachmentId, () => null));
        }
    };
}
