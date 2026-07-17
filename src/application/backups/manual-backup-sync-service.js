import { addBackupSuccess } from "../../domain/backups/backup-policy.js";

export function createManualBackupSyncService({ backupService, memoRepository, localRepository, onCleanupError = console.warn }) {
    async function execute({ user, payload, backupState, sourceRevision = 0, createBackupId, createdAt = Date.now(), localVersion = null }) {
        const backupId = createBackupId();
        const descriptor = await backupService.create({ user, backupId, createdAt, reason: "manual", payload });
        descriptor.sourceRevision = sourceRevision;

        const catalog = addBackupSuccess(backupState, descriptor);
        const backupInfo = {
            id: descriptor.id,
            createdAt: descriptor.createdAt,
            checksum: descriptor.checksum,
            payloadChecksum: descriptor.payloadChecksum,
            sourceRevision
        };
        const activePayload = { ...payload, backupInfo, backupState: catalog.state };

        let promotion;
        try {
            promotion = await memoRepository.promote(user.uid, activePayload, {
                archiveId: descriptor.id,
                archiveMetadata: { createdAt: descriptor.createdAt, sourceRevision }
            });
        } catch (error) {
            try { await backupService.remove({ user, backupId: descriptor.id }); }
            catch (cleanupError) { onCleanupError("Manual backup rollback failed", cleanupError); }
            throw error;
        }

        if (localVersion) await localRepository.acknowledge(user.uid, localVersion, promotion.revision);
        await localRepository.cache(user.uid, activePayload, { remoteRevision: promotion.revision });

        for (const stale of catalog.removed) {
            const results = await Promise.allSettled([
                backupService.remove({ user, backupId: stale.id }),
                memoRepository.deleteArchive(user.uid, stale.id)
            ]);
            if (results.some(result => result.status === "rejected")) onCleanupError("Stale backup cleanup failed", results);
        }

        return { descriptor, backupInfo, backupState: catalog.state, revision: promotion.revision, archived: promotion.archived };
    }

    return { execute };
}

