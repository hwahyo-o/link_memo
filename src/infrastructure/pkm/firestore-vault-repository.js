import { appId, db, doc, getDoc, onSnapshot, setDoc, writeBatch } from "../../services/firebase-client.js";
import { PKM_SCHEMA_VERSION } from "../../domain/pkm/vault-policy.js";

const MAX_CHUNK_BYTES = 360_000;

function chunkFiles(files) {
    const chunks = [];
    let current = [];
    let bytes = 2;
    for (const file of files || []) {
        const encoded = JSON.stringify(file);
        const size = new TextEncoder().encode(encoded).byteLength + 1;
        if (current.length && bytes + size > MAX_CHUNK_BYTES) {
            chunks.push(current);
            current = [];
            bytes = 2;
        }
        current.push(file);
        bytes += size;
    }
    if (current.length || !chunks.length) chunks.push(current);
    return chunks;
}

export function createFirestoreVaultRepository({ database = db, applicationId = appId } = {}) {
    const rootRef = userId => doc(database, "artifacts", applicationId, "users", userId, "memoData", "pkm");
    const chunkRef = (userId, chunkId) => doc(database, "artifacts", applicationId, "users", userId, "memoData", "pkm", "vaultChunks", chunkId);

    async function load(userId) {
        if (!database || !userId) return null;
        const root = await getDoc(rootRef(userId));
        if (!root.exists()) return null;
        const metadata = root.data();
        const chunks = await Promise.all((metadata.chunkIds || []).map(id => getDoc(chunkRef(userId, id))));
        if (chunks.some(chunk => !chunk.exists())) throw new Error("PKM_REMOTE_CHUNK_MISSING");
        return {
            revision: metadata.revision,
            chunkIds: metadata.chunkIds || [],
            snapshot: {
                schemaVersion: Number(metadata.schemaVersion || PKM_SCHEMA_VERSION),
                files: chunks.flatMap(chunk => chunk.data().files || []),
                updatedAt: Number(metadata.updatedAt || 0)
            }
        };
    }

    return {
        load,
        subscribe(userId, onData, onError) {
            if (!database || !userId) return () => {};
            return onSnapshot(rootRef(userId), () => {
                void load(userId).then(onData).catch(onError);
            }, onError);
        },
        async save(userId, snapshot, { previousChunkIds = [] } = {}) {
            if (!database || !userId) throw new Error("FIRESTORE_UNAVAILABLE");
            const revision = crypto.randomUUID?.() || `pkm_${Date.now()}`;
            const groups = chunkFiles(snapshot.files);
            const chunkIds = groups.map((_, index) => `${revision}_${index}`);

            for (let start = 0; start < groups.length; start += 400) {
                const batch = writeBatch(database);
                groups.slice(start, start + 400).forEach((files, offset) => {
                    batch.set(chunkRef(userId, chunkIds[start + offset]), { revision, files });
                });
                await batch.commit();
            }

            await setDoc(rootRef(userId), {
                schemaVersion: PKM_SCHEMA_VERSION,
                revision,
                chunkIds,
                updatedAt: Number(snapshot.updatedAt || Date.now())
            });

            const stale = previousChunkIds.filter(id => !chunkIds.includes(id));
            for (let start = 0; start < stale.length; start += 400) {
                const batch = writeBatch(database);
                stale.slice(start, start + 400).forEach(id => batch.delete(chunkRef(userId, id)));
                await batch.commit();
            }
            return { revision, chunkIds };
        }
    };
}
