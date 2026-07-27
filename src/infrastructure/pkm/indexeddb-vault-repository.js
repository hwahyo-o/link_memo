const DB_NAME = "pkm_index_db";
const DB_VERSION = 1;
const SNAPSHOTS = "vaultSnapshots";
const OUTBOX = "vaultOutbox";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(SNAPSHOTS)) database.createObjectStore(SNAPSHOTS, { keyPath: "userId" });
            if (!database.objectStoreNames.contains(OUTBOX)) database.createObjectStore(OUTBOX, { keyPath: "userId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function transact(mode, callback) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([SNAPSHOTS, OUTBOX], mode);
        let result;
        try {
            result = callback(transaction.objectStore(SNAPSHOTS), transaction.objectStore(OUTBOX));
        } catch (error) {
            transaction.abort();
            reject(error);
            return;
        }
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
            reject(transaction.error || new Error("PKM_INDEXEDDB_ABORTED"));
        };
    });
}

export function createIndexedDbVaultRepository() {
    return {
        async load(userId) {
            if (!userId) return null;
            const database = await openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = database.transaction([SNAPSHOTS, OUTBOX], "readonly");
                const snapshot = transaction.objectStore(SNAPSHOTS).get(userId);
                const outbox = transaction.objectStore(OUTBOX).get(userId);
                transaction.oncomplete = () => {
                    database.close();
                    resolve(snapshot.result ? { ...snapshot.result, dirty: Boolean(outbox.result) } : null);
                };
                transaction.onerror = () => {
                    database.close();
                    reject(transaction.error);
                };
            });
        },

        async savePending(userId, snapshot) {
            const version = crypto.randomUUID?.() || `vault_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const record = { userId, snapshot, version, updatedAt: Date.now() };
            await transact("readwrite", (snapshots, outbox) => {
                snapshots.put(record);
                outbox.put(record);
            });
            return record;
        },

        async cache(userId, snapshot, { remoteRevision = null } = {}) {
            await transact("readwrite", (snapshots, outbox) => {
                const pending = outbox.get(userId);
                pending.onsuccess = () => {
                    if (!pending.result) snapshots.put({ userId, snapshot, version: null, remoteRevision, updatedAt: Date.now() });
                };
            });
        },

        async acknowledge(userId, version, remoteRevision, snapshot) {
            let acknowledged = false;
            await transact("readwrite", (snapshots, outbox) => {
                const pending = outbox.get(userId);
                pending.onsuccess = () => {
                    if (pending.result?.version !== version) return;
                    outbox.delete(userId);
                    snapshots.put({ userId, snapshot, version: null, remoteRevision, updatedAt: Date.now() });
                    acknowledged = true;
                };
            });
            return acknowledged;
        }
    };
}
