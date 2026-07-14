import { describe, expect, it } from "vitest";
import { getLinkImages, validateImageSelection } from "../src/domain/memos/image-attachment-policy.js";

describe("image attachment policy", () => {
    it("reads legacy single-image links as an attachment list", () => {
        expect(getLinkImages({ imageId: "legacy", driveImage: { fileId: "drive" } })).toEqual([{ id: "legacy_legacy", imageId: "legacy", driveImage: { fileId: "drive" } }]);
    });
    it("rejects more than ten attachments", () => {
        const files = Array.from({ length: 11 }, () => ({ type: "image/png" }));
        expect(validateImageSelection(files)).toMatchObject({ ok: false });
    });
});