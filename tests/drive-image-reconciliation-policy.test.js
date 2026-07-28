import { describe, expect, it } from "vitest";
import {
    collectDriveFileIds,
    getKstMonthKey,
    getNextKstMonthKey,
    removeImageAttachment,
    shouldReconcileImages
} from "../src/domain/drive/image-reconciliation-policy.js";

describe("Drive image reconciliation policy", () => {
    it("uses the Korean calendar month at the UTC boundary", () => {
        expect(getKstMonthKey("2026-07-31T14:59:59Z")).toBe("2026-07");
        expect(getKstMonthKey("2026-07-31T15:00:00Z")).toBe("2026-08");
        expect(getNextKstMonthKey("2026-12-15T00:00:00Z")).toBe("2027-01");
    });

    it("runs only when the KST month is pending and the reset hold expired", () => {
        expect(shouldReconcileImages({ currentMonth: "2026-08", lastCompletedMonth: "2026-08" })).toBe(false);
        expect(shouldReconcileImages({ currentMonth: "2026-08", lastCompletedMonth: "2026-07" })).toBe(true);
        expect(shouldReconcileImages({ currentMonth: "2026-08", lastCompletedMonth: "2026-07", cleanupNotBeforeMonth: "2026-09" })).toBe(false);
    });

    it("deduplicates only Drive file references used by site data", () => {
        const linkData = { tab: [{ links: [
            { images: [{ driveImage: { fileId: "a" } }, { driveImage: { fileId: "a" } }] },
            { imageId: "legacy", driveImage: { fileId: "b" } }
        ] }] };
        expect(collectDriveFileIds(linkData)).toEqual(["a", "b"]);
    });

    it("removes one selected carousel attachment without mutating the input", () => {
        const link = { images: [{ id: "one", imageId: "1" }, { id: "two", imageId: "2" }] };
        const result = removeImageAttachment(link, "one");
        expect(result.removed.imageId).toBe("1");
        expect(result.images.map(image => image.id)).toEqual(["two"]);
        expect(link.images).toHaveLength(2);
    });
});
