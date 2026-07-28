import { describe, expect, it, vi } from "vitest";
import { createDriveReconciliationService } from "../src/application/drive/drive-reconciliation-service.js";

describe("Drive reconciliation service", () => {
    it("continues paged cleanup with the same site manifest", async () => {
        const repository = {
            reconcileImages: vi.fn()
                .mockResolvedValueOnce({ jobId: "job", nextPageToken: "next", scanned: 40, deleted: 2 })
                .mockResolvedValueOnce({ jobId: "job", completed: true, scanned: 3, deleted: 1 })
        };
        const service = createDriveReconciliationService({ repository });
        const linkData = { tab: [{ links: [{ images: [{ driveImage: { fileId: "keep" } }] }] }] };
        await expect(service.reconcile(linkData)).resolves.toMatchObject({ completed: true, scanned: 43, deleted: 3 });
        expect(repository.reconcileImages).toHaveBeenNthCalledWith(2, expect.objectContaining({
            activeFileIds: ["keep"],
            jobId: "job",
            pageToken: "next"
        }));
    });

    it("does not continue when reset cleanup needs user confirmation", async () => {
        const repository = { reconcileImages: vi.fn().mockResolvedValue({ resetDecisionRequired: true }) };
        const service = createDriveReconciliationService({ repository });
        await expect(service.reconcile({})).resolves.toMatchObject({ resetDecisionRequired: true });
        expect(repository.reconcileImages).toHaveBeenCalledTimes(1);
    });
});
