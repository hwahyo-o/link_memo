import { projectMainMemoToVaultFiles } from "../../application/pkm/link-memo-vault-projector.js";
import { appId, db, doc, getDoc } from "../../services/firebase-client.js";

function requestValue(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function inspectDatabase(name) {
    const database = await requestValue(indexedDB.open(name));
    const stores = [];
    try {
        for (const storeName of database.objectStoreNames) {
            const transaction = database.transaction(storeName, "readonly");
            const sample = await requestValue(transaction.objectStore(storeName).getAll(undefined, 3));
            stores.push({
                name: storeName,
                sampleKeys: [...new Set(sample.flatMap(value => value && typeof value === "object" ? Object.keys(value) : []))]
            });
        }
    } finally {
        database.close();
    }
    return { name, stores };
}

export async function discoverLocalSchemas() {
    const databases = typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [{ name: "linkMemoData" }, { name: "linkMemoImages" }, { name: "pkm_index_db" }];
    const names = [...new Set(databases.map(item => item.name).filter(Boolean))];
    return Promise.all(names.map(inspectDatabase));
}

export async function discoverMainMemoPayload(userId, { database = db, applicationId = appId } = {}) {
    if (!database || !userId) return null;
    const snapshot = await getDoc(doc(database, "artifacts", applicationId, "users", userId, "memoData", "main"));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
        keys: Object.keys(data),
        payload: data
    };
}

export const mainMemoToVaultFiles = projectMainMemoToVaultFiles;
