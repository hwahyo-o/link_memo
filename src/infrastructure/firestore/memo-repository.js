import { db, appId, doc, setDoc, onSnapshot, deleteDoc, runTransaction, deleteField, FieldPath } from "../../services/firebase-client.js";

function sameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

// Infrastructure: Firestore 문서·낙관적 동시성·카테고리 단위 저장을 이 모듈 안에 가둡니다.
export function createFirestoreMemoRepository({ database = db, applicationId = appId } = {}) {
    const getReference = userId => {
        if (!database || !userId) return null;
        return doc(database, "artifacts", applicationId, "users", userId, "memoData", "main");
    };
    const getArchiveReference = (userId, archiveId) => {
        if (!database || !userId || !archiveId) return null;
        return doc(database, "artifacts", applicationId, "users", userId, "memoData", `archive_${archiveId}`);
    };

    return {
        subscribe(userId, onData, onError) {
            const reference = getReference(userId);
            if (!reference) return () => {};
            return onSnapshot(reference, onData, onError);
        },

        async save(userId, data, { expectedRevision = null, allowCreate = false } = {}) {
            const reference = getReference(userId);
            if (!reference) return { revision: expectedRevision ?? 0, skipped: true };
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

                if (!current.exists()) {
                    const revision = remoteRevision + 1;
                    transaction.set(reference, { ...data, revision, updatedAt: Date.now() });
                    return { revision, skipped: false };
                }

                const remoteLinkData = remote.linkData && typeof remote.linkData === "object" ? remote.linkData : {};
                const nextLinkData = data.linkData && typeof data.linkData === "object" ? data.linkData : {};
                const categoryNames = new Set([...Object.keys(remoteLinkData), ...Object.keys(nextLinkData)]);
                const changedCategories = [...categoryNames].filter(
                    category => !sameValue(remoteLinkData[category], nextLinkData[category])
                );
                const metadataChanged = [
                    ["categories", data.categories],
                    ["uiPreferences", data.uiPreferences],
                    ["driveConnection", data.driveConnection],
                    ["backupInfo", data.backupInfo || null],
                    ["backupState", data.backupState || null]
                ].some(([key, value]) => !sameValue(remote[key], value));

                if (!changedCategories.length && !metadataChanged) {
                    return { revision: remoteRevision, skipped: true };
                }

                for (const category of changedCategories) {
                    transaction.update(
                        reference,
                        new FieldPath("linkData", category),
                        Object.prototype.hasOwnProperty.call(nextLinkData, category) ? nextLinkData[category] : deleteField()
                    );
                }

                const revision = remoteRevision + 1;
                transaction.update(reference, {
                    categories: data.categories,
                    uiPreferences: data.uiPreferences,
                    driveConnection: data.driveConnection,
                    backupInfo: data.backupInfo || null,
                    backupState: data.backupState || null,
                    revision,
                    updatedAt: Date.now()
                });
                return { revision, skipped: false };
            });
        },

        async promote(userId, data, { archiveId, archiveMetadata = null } = {}) {
            const reference = getReference(userId);
            const archiveReference = getArchiveReference(userId, archiveId);
            if (!reference || !archiveReference) {
                const error = new Error("FIRESTORE_UNAVAILABLE");
                error.code = "FIRESTORE_UNAVAILABLE";
                throw error;
            }

            return runTransaction(database, async transaction => {
                const current = await transaction.get(reference);
                const previous = current.data() || null;
                const revision = Number(previous?.revision || 0) + 1;
                const updatedAt = Date.now();

                if (previous) {
                    transaction.set(archiveReference, {
                        ...previous,
                        archiveId,
                        archivedAt: updatedAt,
                        sourceRevision: Number(previous.revision || 0),
                        archiveMetadata
                    });
                }

                transaction.set(reference, { ...data, revision, updatedAt });
                return { revision, archived: Boolean(previous) };
            });
        },

        deleteArchive(userId, archiveId) {
            const reference = getArchiveReference(userId, archiveId);
            return reference ? deleteDoc(reference) : Promise.resolve();
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

