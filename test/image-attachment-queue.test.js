import { describe, expect, it, vi } from "vitest";
import { createImageAttachmentQueue } from "../src/application/memos/image-attachment-queue.js";

describe("image attachment queue", () => {
    it("reports local and Drive outcomes without blocking attachment creation", async () => {
        const attachments = [];
        const progress = [];
        const queue = createImageAttachmentQueue({
            saveLocalImage: async file => `local-${file.name}`,
            uploadDriveImage: async file => ({ fileId: `drive-${file.name}` }),
            createAttachmentId: () => "attachment",
            canUploadToDrive: () => true,
            concurrency: 2
        });

        const result = await queue.process({
            files: [{ name: "one" }, { name: "two" }],
            onAttachment: attachment => attachments.push(attachment),
            onProgress: state => progress.push(state)
        });

        expect(result).toMatchObject({ total: 2, completed: 2, failed: 0, driveFailed: 0 });
        expect(attachments).toHaveLength(2);
        expect(attachments[0].driveImage.fileId).toBe("drive-one");
        expect(progress.at(-1)).toMatchObject({ pending: 0 });
    });

    it("keeps local attachment when Drive upload fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const attachments = [];
        const queue = createImageAttachmentQueue({
            saveLocalImage: async () => "local",
            uploadDriveImage: async () => { throw new Error("offline"); },
            createAttachmentId: () => "attachment",
            canUploadToDrive: () => true
        });

        const result = await queue.process({ files: [{ name: "one" }], onAttachment: item => attachments.push(item) });
        expect(result).toMatchObject({ completed: 1, failed: 0, driveFailed: 1 });
        expect(attachments[0]).toMatchObject({ imageId: "local", driveImage: null });
        warn.mockRestore();
    });
});