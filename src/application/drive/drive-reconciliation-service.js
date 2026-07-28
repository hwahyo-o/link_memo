import { collectDriveFileIds } from "../../domain/drive/image-reconciliation-policy.js";

export function createDriveReconciliationService({ repository }) {
    return {
        status() {
            return repository.getReconciliationStatus();
        },

        async reconcile(linkData, { confirmResetCleanup = false } = {}) {
            const activeFileIds = collectDriveFileIds(linkData);
            let jobId = null;
            let pageToken = null;
            const totals = { scanned: 0, deleted: 0 };
            do {
                const result = await repository.reconcileImages({
                    activeFileIds,
                    jobId,
                    pageToken,
                    confirmResetCleanup
                });
                if (result.skipped || result.deferred || result.resetDecisionRequired) return { ...result, ...totals };
                jobId = result.jobId || jobId;
                pageToken = result.nextPageToken || null;
                totals.scanned += Number(result.scanned || 0);
                totals.deleted += Number(result.deleted || 0);
                if (result.completed) return { ...result, ...totals };
            } while (pageToken);
            return { completed: true, ...totals };
        },

        deferAfterReset() {
            return repository.deferReconciliationAfterReset();
        },

        clearResetHold() {
            return repository.clearReconciliationResetHold();
        },

        deleteDriveAccount() {
            return repository.deleteAccountData();
        }
    };
}
