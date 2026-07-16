// Infrastructure: 로그인한 사용자의 메모 스냅샷과 최신 동기화 대기 항목을 IndexedDB에 보관합니다.
const DB_NAME = "linkMemoData";
const STORE_SNAPSHOTS = "memoSnapshots";
const STORE_OUTBOX = "memoOutbox";

function openMemoDb() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) return reject(new Error("IndexedDB 미지원"));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_SNAPSHOTS)) database.createObjectStore(STORE_SNAPSHOTS, { keyPath: "userId" });
            if (!database.objectStoreNames.contains(STORE_OUTBOX)) database.createObjectStore(STORE_OUTBOX, { keyPath: "userId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function runTransaction(storeNames, mode, callback) {
    const database = await openMemoDb();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeNames, mode);
        let result;
        try {
            result = callback(Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)])));
        } catch (error) {
            database.close();
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
            reject(transaction.error || new Error("IndexedDB transaction aborted"));
        };
    });
}

function createVersion() {
    return crypto.randomUUID?.() || `memo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createIndexedDbMemoRepository() {
    return {
        async load(userId) {
            if (!userId) return null;
            const database = await openMemoDb();
            return new Promise((resolve, reject) => {
                const transaction = database.transaction([STORE_SNAPSHOTS, STORE_OUTBOX], "readonly");
                const snapshotRequest = transaction.objectStore(STORE_SNAPSHOTS).get(userId);
                const outboxRequest = transaction.objectStore(STORE_OUTBOX).get(userId);
                transaction.oncomplete = () => {
                    database.close();
                    const snapshot = snapshotRequest.result || null;
                    resolve(snapshot ? { ...snapshot, dirty: Boolean(outboxRequest.result) } : null);
                };
                transaction.onerror = () => {
                    database.close();
                    reject(transaction.error);
                };
            });
        },

        async savePending(userId, payload, { remoteRevision = null } = {}) {
            if (!userId) return null;
            const version = createVersion();
            const record = { userId, payload, remoteRevision, version, updatedAt: Date.now() };
            await runTransaction([STORE_SNAPSHOTS, STORE_OUTBOX], "readwrite", stores => {
                stores[STORE_SNAPSHOTS].put(record);
                stores[STORE_OUTBOX].put(record);
            });
            return record;
        },

        async cache(userId, payload, { remoteRevision = null } = {}) {
            if (!userId) return;
            await runTransaction([STORE_SNAPSHOTS, STORE_OUTBOX], "readwrite", stores => {
                const pendingRequest = stores[STORE_OUTBOX].get(userId);
                pendingRequest.onsuccess = () => {
                    if (!pendingRequest.result) {
                        stores[STORE_SNAPSHOTS].put({ userId, payload, remoteRevision, version: null, updatedAt: Date.now() });
                    }
                };
            });
        },

        async acknowledge(userId, version, remoteRevision) {
            if (!userId || !version) return false;
            let acknowledged = false;
            await runTransaction([STORE_SNAPSHOTS, STORE_OUTBOX], "readwrite", stores => {
                const pendingRequest = stores[STORE_OUTBOX].get(userId);
                const snapshotRequest = stores[STORE_SNAPSHOTS].get(userId);
                pendingRequest.onsuccess = () => {
                    if (pendingRequest.result?.version === version) {
                        stores[STORE_OUTBOX].delete(userId);
                        acknowledged = true;
                    }
                };
                snapshotRequest.onsuccess = () => {
                    const snapshot = snapshotRequest.result;
                    if (snapshot?.version === version) {
                        stores[STORE_SNAPSHOTS].put({ ...snapshot, remoteRevision, version: null, updatedAt: Date.now() });
                    }
                };
            });
            return acknowledged;
        },

        async clear(userId) {
            if (!userId) return;
            await runTransaction([STORE_SNAPSHOTS, STORE_OUTBOX], "readwrite", stores => {
                stores[STORE_SNAPSHOTS].delete(userId);
                stores[STORE_OUTBOX].delete(userId);
            });
        }
    };
}
