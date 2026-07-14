import { db, appId, doc, setDoc, onSnapshot, deleteDoc, runTransaction, deleteField, FieldPath } from "../../services/firebase-client.js";

const BACKUP_COLLECTION = "backups";

function sameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

// Infrastructure: Firestore 문서·백업·낙관적 동시성·카테고리 단위 저장을 이 모듈 안에 가둡니다.
export function createFirestoreMemoRepository({ database = db, applicationId = appId } = {}) {
    const getReference = userId => {
        if (!database || !userId) return null;
        return doc(database, "artifacts", applicationId, "users", userId, "memoData", "main");
    };

    const backupReference = (userId, backupId) => {
        const reference = getReference(userId);
        return reference ? doc(reference, BACKUP_COLLECTION, backupId) : null;
    };

    return {
        subscribe(userId, onData, onError) {
            const reference = getReference(userId);
            if (!reference) return () => {};
            return onSnapshot(reference, onData, onError);
        },

        async save(userId, data, { expectedRevision = null, allowCreate = false } = {}) {
            const reference = getReference(userId);
            if (!reference) return { revision: expectedRevision ?? 0 };
            return runTransaction(database, async transaction => {
                const current = await transaction.get(reference);
                if (!current.exists() && !allowCreate) {
                    const error = new Error("MEMO_DOCUMENT_MISSING");
                    error.code = "MEMO_DOCUMENT_MISSING";
                    throw error;
                }
                const remote = current.data() || {};
                const remoteRevision = Number(remote.revision || 0);
                if (expectedRevision !== null && remoteRevision !== expectedRevision) {
                    const error = new Error("MEMO_CONFLICT");
                    error.code = "MEMO_CONFLICT";
                    throw error;
                }

                const revision = remoteRevision + 1;
                if (!current.exists()) {
                    transaction.set(reference, { ...data, revision, updatedAt: Date.now() });
                    return { revision };
                }

                // Do not replace the whole linkData map. Only changed categories are updated.
                const remoteLinkData = remote.linkData && typeof remote.linkData === "object" ? remote.linkData : {};
                const nextLinkData = data.linkData && typeof data.linkData === "object" ? data.linkData : {};
                const categoryNames = new Set([...Object.keys(remoteLinkData), ...Object.keys(nextLinkData)]);
                for (const category of categoryNames) {
                    if (sameValue(remoteLinkData[category], nextLinkData[category])) continue;
                    transaction.update(
                        reference,
                        new FieldPath("linkData", category),
                        Object.prototype.hasOwnProperty.call(nextLinkData, category) ? nextLinkData[category] : deleteField()
                    );
                }

                transaction.update(reference, {
                    categories: data.categories,
                    uiPreferences: data.uiPreferences,
                    driveConnection: data.driveConnection,
                    backupInfo: data.backupInfo || null,
                    revision,
                    updatedAt: Date.now()
                });
                return { revision };
            });
        },

        async createBackup(userId, data, { revision = 0, reason = "interval" } = {}) {
            const id = `backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const reference = backupReference(userId, id);
            if (!reference) return null;
            const createdAt = Date.now();
            await setDoc(reference, {
                version: 1,
                sourceRevision: revision,
                reason,
                createdAt,
                data
            });
            return { id, createdAt };
        },

        savePreferences(userId, uiPreferences) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            return setDoc(reference, { uiPreferences }, { merge: true });
        },

        delete(userId) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            return deleteDoc(reference);
        }
    };
}
