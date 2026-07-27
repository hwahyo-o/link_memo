import { appId, db, doc, getDoc, onSnapshot, runTransaction, writeBatch } from "../../services/firebase-client.js";
import { PKM_SCHEMA_VERSION } from "../../domain/pkm/vault-policy.js";
import { decodeVaultFileChunks, encodeVaultFiles } from "../../domain/pkm/vault-chunk-codec.js";

const MAX_CHUNKS_PER_BATCH = 20;

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
        const chunkData = chunks.map(chunk => chunk.data());
        return {
            revision: metadata.revision,
            chunkIds: metadata.chunkIds || [],
            snapshot: {
                schemaVersion: Number(metadata.schemaVersion || PKM_SCHEMA_VERSION),
                files: decodeVaultFileChunks(chunkData),
                updatedAt: Number(metadata.updatedAt || 0)
            }
        };
    }

    async function deleteChunks(userId, chunkIds) {
        for (let start = 0; start < chunkIds.length; start += 400) {
            const batch = writeBatch(database);
            chunkIds.slice(start, start + 400).forEach(id => batch.delete(chunkRef(userId, id)));
            await batch.commit();
        }
    }

    return {
        load,
        subscribe(userId, onData, onError) {
            if (!database || !userId) return () => {};
            return onSnapshot(rootRef(userId), () => {
                void load(userId).then(onData).catch(onError);
            }, onError);
        },
        async save(userId, snapshot, { expectedRevision = null, previousChunkIds = [] } = {}) {
            if (!database || !userId) throw new Error("FIRESTORE_UNAVAILABLE");
            const revision = crypto.randomUUID?.() || `pkm_${Date.now()}`;
            const payloadParts = encodeVaultFiles(snapshot.files);
            const chunkIds = payloadParts.map((_, index) => `${revision}_${index}`);

            for (let start = 0; start < payloadParts.length; start += MAX_CHUNKS_PER_BATCH) {
                const batch = writeBatch(database);
                payloadParts.slice(start, start + MAX_CHUNKS_PER_BATCH).forEach((payloadPart, offset) => {
                    batch.set(chunkRef(userId, chunkIds[start + offset]), {
                        revision,
                        index: start + offset,
                        payloadPart
                    });
                });
                await batch.commit();
            }

            try {
                await runTransaction(database, async transaction => {
                    const current = await transaction.get(rootRef(userId));
                    const currentRevision = current.exists() ? current.data().revision || null : null;
                    if (currentRevision !== expectedRevision) {
                        const error = new Error("PKM_REMOTE_REVISION_CHANGED");
                        error.code = "PKM_REMOTE_REVISION_CHANGED";
                        throw error;
                    }
                    transaction.set(rootRef(userId), {
                        schemaVersion: PKM_SCHEMA_VERSION,
                        revision,
                        chunkIds,
                        updatedAt: Number(snapshot.updatedAt || Date.now())
                    });
                });
            } catch (error) {
                try { await deleteChunks(userId, chunkIds); } catch { /* unreferenced chunks can be reclaimed later */ }
                throw error;
            }

            const stale = previousChunkIds.filter(id => !chunkIds.includes(id));
            await deleteChunks(userId, stale);
            return { revision, chunkIds };
        }
    };
}
