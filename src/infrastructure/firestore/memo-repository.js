import { db, appId, doc, setDoc, onSnapshot, deleteDoc, runTransaction, deleteField, FieldPath } from "../../services/firebase-client.js";
import { mergeMemoPayloads } from "../../domain/sync/memo-merge-policy.js";

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

                if (!current.exists()) {
                    const revision = remoteRevision + 1;
                    const created = { ...data, revision, updatedAt: Number(data.updatedAt || Date.now()) };
                    transaction.set(reference, created);
                    return { revision, skipped: false, payload: created };
                }

                // A stale device never overwrites the current document wholesale. The transaction
                // resolves every entity by updatedAt/mutationId and commits the deterministic merge.
                const merged = mergeMemoPayloads(remote, data, {
                    leftUpdatedAt: remote.updatedAt,
                    rightUpdatedAt: data.updatedAt
                });

                const remoteLinkData = remote.linkData && typeof remote.linkData === "object" ? remote.linkData : {};
                const nextLinkData = merged.linkData && typeof merged.linkData === "object" ? merged.linkData : {};
                const categoryNames = new Set([...Object.keys(remoteLinkData), ...Object.keys(nextLinkData)]);
                const changedCategories = [...categoryNames].filter(
                    category => !sameValue(remoteLinkData[category], nextLinkData[category])
                );
                const metadataChanged = [
                    ["categories", merged.categories],
                    ["uiPreferences", merged.uiPreferences],
                    ["driveConnection", merged.driveConnection],
                    ["backupInfo", merged.backupInfo || null],
                    ["backupState", merged.backupState || null],
                    ["syncMeta", merged.syncMeta || null]
                ].some(([key, value]) => !sameValue(remote[key], value));

                if (!changedCategories.length && !metadataChanged) {
                    return { revision: remoteRevision, skipped: true, payload: remote };
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
                    categories: merged.categories,
                    uiPreferences: merged.uiPreferences,
                    driveConnection: merged.driveConnection,
                    backupInfo: merged.backupInfo || null,
                    backupState: merged.backupState || null,
                    syncMeta: merged.syncMeta || null,
                    revision,
                    updatedAt: Math.max(Number(merged.updatedAt || 0), Date.now())
                });
                return { revision, skipped: false, payload: { ...merged, revision } };
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

        delete(userId, { archiveIds = [] } = {}) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            const archiveDeletes = [...new Set(archiveIds)]
                .map(archiveId => getArchiveReference(userId, archiveId))
                .filter(Boolean)
                .map(deleteDoc);
            return Promise.all([deleteDoc(reference), ...archiveDeletes]);
        }
    };
}

