const DATABASE_NAME = "second_brain_attachments";
const DATABASE_VERSION = 1;
const QUEUE_STORE = "uploadQueue";
const USER_INDEX = "byUserId";

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

export function createIndexedDbAttachmentQueue() {
    return {
        async savePending({ userId, attachment, file }) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(attachment?.id);
            if (!file || typeof file.size !== "number") throw new Error("ATTACHMENT_QUEUE_FILE_REQUIRED");

            const record = {
                ...attachment,
                id: attachmentId,
                userId: ownerId,
                file,
                retryCount: 0,
                lastErrorCode: null,
                queuedAt: Date.now(),
                updatedAt: Date.now()
            };

            await transact("readwrite", store => store.put(record));
            return { ...record, file: undefined };
        },

        async listPending(userId) {
            const ownerId = requireUserId(userId);
            const records = await transact("readonly", store => store.index(USER_INDEX).getAll(ownerId));
            return records.map(({ file, ...record }) => record);
        },

        async loadFile(userId, id) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            const record = await transact("readonly", store => store.get(attachmentId));
            if (!record || record.userId !== ownerId) return null;
            return record.file || null;
        },

        async markAttempt(userId, id, { errorCode = null } = {}) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            const current = await transact("readonly", store => store.get(attachmentId));
            if (!current || current.userId !== ownerId) return null;

            const updated = {
                ...current,
                retryCount: Number(current.retryCount || 0) + 1,
                lastErrorCode: errorCode ? String(errorCode).slice(0, 120) : null,
                updatedAt: Date.now()
            };
            await transact("readwrite", store => store.put(updated));
            return { ...updated, file: undefined };
        },

        async removePending(userId, id) {
            const ownerId = requireUserId(userId);
            const attachmentId = requireAttachmentId(id);
            const current = await transact("readonly", store => store.get(attachmentId));
            if (!current || current.userId !== ownerId) return false;
            await transact("readwrite", store => store.delete(attachmentId));
            return true;
        }
    };
}
