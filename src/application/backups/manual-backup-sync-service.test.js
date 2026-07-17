import { describe, expect, it, vi } from "vitest";
import { createManualBackupSyncService } from "./manual-backup-sync-service.js";

function createService({ promote = vi.fn(async () => ({ revision: 7, archived: true })) } = {}) {
    const backupService = {
        create: vi.fn(async ({ backupId, createdAt }) => ({ id: backupId, createdAt, checksum: "checksum", payloadChecksum: "payload", size: 1 })),
        remove: vi.fn(async () => {})
    };
    const memoRepository = { promote, deleteArchive: vi.fn(async () => {}) };
    const localRepository = { acknowledge: vi.fn(async () => true), cache: vi.fn(async () => {}) };
    return { service: createManualBackupSyncService({ backupService, memoRepository, localRepository, onCleanupError: () => {} }), backupService, memoRepository, localRepository };
}

describe("manual backup sync", () => {
    it("creates a backup, archives the previous active document, and promotes the mobile snapshot", async () => {
        const { service, memoRepository, localRepository } = createService();
        const result = await service.execute({
            user: { uid: "user-1" },
            payload: { categories: ["mobile"], linkData: {}, uiPreferences: {}, driveConnection: {} },
            backupState: {},
            sourceRevision: 3,
            localVersion: "local-1",
            createBackupId: () => "backup_manual_1",
            createdAt: 100
        });

        expect(memoRepository.promote).toHaveBeenCalledWith("user-1", expect.objectContaining({
            categories: ["mobile"],
            backupInfo: expect.objectContaining({ id: "backup_manual_1", sourceRevision: 3 })
        }), expect.objectContaining({ archiveId: "backup_manual_1" }));
        expect(localRepository.acknowledge).toHaveBeenCalledWith("user-1", "local-1", 7);
        expect(result).toMatchObject({ revision: 7, archived: true });
    });

    it("removes the new R2 backup when Firebase promotion fails", async () => {
        const promote = vi.fn(async () => { throw new Error("FIRESTORE_UNAVAILABLE"); });
        const { service, backupService } = createService({ promote });

        await expect(service.execute({
            user: { uid: "user-1" },
            payload: { categories: [], linkData: {}, uiPreferences: {}, driveConnection: {} },
            backupState: {},
            createBackupId: () => "backup_manual_2"
        })).rejects.toThrow("FIRESTORE_UNAVAILABLE");
        expect(backupService.remove).toHaveBeenCalledWith({ user: { uid: "user-1" }, backupId: "backup_manual_2" });
    });
});

