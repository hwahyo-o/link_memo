import { describe, expect, it, vi } from "vitest";
import { createDriveImageService } from "./drive-image-service.js";

function createService({ localImages = {}, verification = [] } = {}) {
    const localImageRepository = {
        get: vi.fn(async id => localImages[id] ? { blob: localImages[id] } : null)
    };
    const driveImageRepository = {
        verifyImages: vi.fn(async () => ({ images: verification })),
        upload: vi.fn(async file => ({ id: `new-${file.name}`, name: file.name, mimeType: "image/png" })),
        download: vi.fn(),
        prefetch: vi.fn(),
        remove: vi.fn(),
        restoreSession: vi.fn()
    };
    return {
        service: createDriveImageService({ localImageRepository, driveImageRepository, driveCodeProvider: {} }),
        driveImageRepository
    };
}

describe("Drive image repair", () => {
    it("replaces deleted Drive references from the original browser image and reports unrecoverable items", async () => {
        const { service, driveImageRepository } = createService({
            localImages: {
                repair: { name: "repair.png" },
                new: { name: "new.png" }
            },
            verification: [
                { fileId: "available-id", state: "available" },
                { fileId: "deleted-id", state: "missing" },
                { fileId: "lost-id", state: "missing" }
            ]
        });
        const links = {
            개인: [{ links: [
                { id: "available", imageId: "available", driveImage: { fileId: "available-id" } },
                { id: "repair", imageId: "repair", driveImage: { fileId: "deleted-id" } },
                { id: "lost", imageId: "lost", driveImage: { fileId: "lost-id" } },
                { id: "new", imageId: "new" }
            ] }]
        };

        const result = await service.repairDriveImages(links, { permissionGranted: true });

        expect(driveImageRepository.verifyImages).toHaveBeenCalledWith(["available-id", "deleted-id", "lost-id"]);
        expect(result).toMatchObject({ total: 4, available: 1, repaired: 1, uploaded: 1, unrecoverable: 1, failed: 0 });
        expect(links.개인[0].links[1].driveImage.fileId).toBe("new-repair.png");
        expect(links.개인[0].links[2].driveImage.availability).toBe("missing");
        expect(links.개인[0].links[3].driveImage.fileId).toBe("new-new.png");
    });

    it("identifies a missing remote image while keeping the local preview available", async () => {
        const localImageRepository = { get: vi.fn(async () => ({ blob: { name: "local.png" } })) };
        const driveImageRepository = {
            download: vi.fn(async () => { throw Object.assign(new Error("DRIVE_API_404"), { status: 404 }); }),
            verifyImages: vi.fn(),
            upload: vi.fn(),
            prefetch: vi.fn(),
            remove: vi.fn(),
            restoreSession: vi.fn()
        };
        const service = createDriveImageService({ localImageRepository, driveImageRepository, driveCodeProvider: {} });

        const preview = await service.loadImage(
            { imageId: "local", driveImage: { fileId: "deleted-id" } },
            { permissionGranted: true }
        );

        expect(preview).toMatchObject({ source: "local", driveMissing: true });
    });

    it("returns a connection error instead of reporting all images as synchronized", async () => {
        const { service, driveImageRepository } = createService({
            localImages: { local: { name: "local.png" } },
            verification: []
        });
        driveImageRepository.verifyImages.mockRejectedValueOnce(new Error("DRIVE_NOT_CONNECTED"));
        const links = { 개인: [{ links: [{ id: "local", imageId: "local", driveImage: { fileId: "missing-id" } }] }] };

        const result = await service.repairDriveImages(links, { permissionGranted: true });

        expect(result.error?.message).toBe("DRIVE_NOT_CONNECTED");
        expect(result.failed).toBe(1);
    });
});
