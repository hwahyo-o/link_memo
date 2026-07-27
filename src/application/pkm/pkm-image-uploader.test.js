import { describe, expect, it, vi } from "vitest";
import { createPkmImageUploader } from "./pkm-image-uploader.js";

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

describe("PKM image uploader", () => {
    it("does not start a Drive upload after the authenticated user changes", async () => {
        let user = { uid: "A" };
        const localSave = deferred();
        const driveImageService = { upload: vi.fn() };
        const upload = createPkmImageUploader({
            getCurrentUser: () => user,
            localImageRepository: { save: vi.fn(() => localSave.promise) },
            driveImageService,
            getDriveConnection: () => ({ permissionGranted: true }),
            setDriveConnection: vi.fn()
        });

        const result = upload({ name: "a.png" });
        user = { uid: "B" };
        localSave.resolve();
        await expect(result).rejects.toThrow("AUTH_SESSION_CHANGED");
        expect(driveImageService.upload).not.toHaveBeenCalled();
    });

    it("does not attach a completed upload to a different authenticated user", async () => {
        let user = { uid: "A" };
        const remote = deferred();
        const setDriveConnection = vi.fn();
        const upload = createPkmImageUploader({
            getCurrentUser: () => user,
            localImageRepository: { save: vi.fn(async () => {}) },
            driveImageService: { upload: vi.fn(() => remote.promise) },
            getDriveConnection: () => ({ permissionGranted: true }),
            setDriveConnection
        });

        const result = upload({ name: "a.png" });
        await Promise.resolve();
        user = { uid: "B" };
        remote.resolve({ driveImage: { fileId: "drive-a" }, connection: { permissionGranted: true } });
        await expect(result).rejects.toThrow("AUTH_SESSION_CHANGED");
        expect(setDriveConnection).not.toHaveBeenCalled();
    });

    it("preserves the normal local and Drive upload flow for one user", async () => {
        const user = { uid: "A" };
        const setDriveConnection = vi.fn();
        const upload = createPkmImageUploader({
            getCurrentUser: () => user,
            localImageRepository: { save: vi.fn(async () => {}) },
            driveImageService: {
                upload: vi.fn(async () => ({
                    driveImage: { fileId: "drive-a" },
                    connection: { permissionGranted: true }
                }))
            },
            getDriveConnection: () => ({ permissionGranted: true }),
            setDriveConnection
        });

        await expect(upload({ name: "a.png" })).resolves.toBe("![a.png](drive://drive-a)");
        expect(setDriveConnection).toHaveBeenCalledOnce();
    });
});
