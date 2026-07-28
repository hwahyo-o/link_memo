import { describe, expect, it, vi } from "vitest";
import { createLifecycleSyncService } from "./lifecycle-sync-service.js";

function registeredService(overrides = {}) {
    return createLifecycleSyncService({
        getSession: () => ({ user: { uid: "u1", isAnonymous: false }, payload: {} }),
        waitForUploads: vi.fn(async () => {}),
        ensureRemoteImages: vi.fn(async () => {}),
        persistLatest: vi.fn(async () => {}),
        flushFirebase: vi.fn(async () => {}),
        loadDurable: vi.fn(async () => ({ payload: { latest: true }, dirty: false })),
        saveCheckpoint: vi.fn(async () => {}),
        saveCheckpointKeepalive: vi.fn(),
        ...overrides
    });
}

describe("lifecycle sync service", () => {
    it("fully persists registered accounts before logout", async () => {
        const order = [];
        const service = registeredService({
            waitForUploads: async () => order.push("images"),
            ensureRemoteImages: async () => order.push("drive"),
            persistLatest: async () => order.push("indexeddb"),
            flushFirebase: async () => order.push("firebase"),
            saveCheckpoint: async () => order.push("cloudflare")
        });
        await service.flushBeforeLogout();
        expect(order).toEqual(["images", "drive", "indexeddb", "firebase", "cloudflare"]);
    });

    it("allows a guest to logout after local persistence even while remote state is dirty", async () => {
        const order = [];
        const flushFirebase = vi.fn();
        const saveCheckpoint = vi.fn();
        const ensureRemoteImages = vi.fn();
        const service = createLifecycleSyncService({
            getSession: () => ({ user: { uid: "guest", isAnonymous: true }, payload: {} }),
            waitForUploads: async () => order.push("images"),
            ensureRemoteImages,
            persistLatest: async () => order.push("indexeddb"),
            flushFirebase,
            loadDurable: async () => ({ payload: { local: true }, dirty: true }),
            saveCheckpoint,
            saveCheckpointKeepalive: vi.fn()
        });
        await expect(service.flushBeforeLogout()).resolves.toMatchObject({ payload: { local: true }, dirty: true });
        expect(order).toEqual(["images", "indexeddb"]);
        expect(ensureRemoteImages).not.toHaveBeenCalled();
        expect(flushFirebase).not.toHaveBeenCalled();
        expect(saveCheckpoint).not.toHaveBeenCalled();
    });

    it("labels a missing guest payload as a local verification failure", async () => {
        const service = createLifecycleSyncService({
            getSession: () => ({ user: { uid: "guest", isAnonymous: true }, payload: {} }),
            waitForUploads: vi.fn(async () => {}),
            persistLatest: vi.fn(async () => {}),
            flushFirebase: vi.fn(),
            loadDurable: vi.fn(async () => null),
            saveCheckpoint: vi.fn(),
            saveCheckpointKeepalive: vi.fn()
        });

        await expect(service.flushBeforeLogout()).rejects.toMatchObject({
            message: "MEMO_LOCAL_PERSIST_INCOMPLETE",
            syncStage: "local-verify"
        });
    });

    it("shares one durable write between manual save and logout", async () => {
        let releaseUploads;
        const waitForUploads = vi.fn(() => new Promise(resolve => { releaseUploads = resolve; }));
        const service = registeredService({ waitForUploads });
        const manualSave = service.saveNow();
        const logoutSave = service.flushBeforeLogout();
        expect(logoutSave).toBe(manualSave);
        await vi.waitFor(() => expect(waitForUploads).toHaveBeenCalledTimes(1));
        releaseUploads();
        await expect(Promise.all([manualSave, logoutSave])).resolves.toEqual([
            expect.objectContaining({ dirty: false }),
            expect.objectContaining({ dirty: false })
        ]);
    });

    it("labels Drive image failures before any remote memo write", async () => {
        const flushFirebase = vi.fn();
        const service = registeredService({
            ensureRemoteImages: async () => { throw new Error("DRIVE_IMAGES_INCOMPLETE"); },
            flushFirebase
        });
        await expect(service.saveNow()).rejects.toMatchObject({
            message: "DRIVE_IMAGES_INCOMPLETE",
            syncStage: "drive-images"
        });
        expect(flushFirebase).not.toHaveBeenCalled();
    });

    it("persists the latest payload before a hidden-page remote flush", async () => {
        const order = [];
        let persisted = false;
        const saveCheckpoint = vi.fn(async () => order.push("cloudflare"));
        const service = registeredService({
            getSession: () => ({
                user: { uid: "u1", isAnonymous: false },
                payload: { version: persisted ? "latest" : "stale" }
            }),
            persistLatest: async () => { order.push("indexeddb"); persisted = true; },
            flushFirebase: async () => order.push("firebase"),
            loadDurable: async () => ({ payload: { version: "latest" }, dirty: false }),
            saveCheckpoint
        });
        await expect(service.flushForPageExit()).resolves.toBe(true);
        expect(order).toEqual(["indexeddb", "firebase", "cloudflare"]);
        expect(saveCheckpoint).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "u1" }),
            { version: "latest" },
            expect.any(Number)
        );
    });

    it("identifies a Cloudflare checkpoint failure before logout", async () => {
        const service = registeredService({ saveCheckpoint: async () => { throw new Error("NOT_FOUND"); } });
        await expect(service.flushBeforeLogout()).rejects.toMatchObject({
            message: "NOT_FOUND",
            syncStage: "cloudflare-checkpoint"
        });
    });

    it("falls back to a keepalive checkpoint if the hidden flush fails", async () => {
        const keepalive = vi.fn(() => true);
        const service = registeredService({
            getSession: () => ({ user: { uid: "u1", isAnonymous: false }, payload: { latest: true } }),
            flushFirebase: async () => { throw new Error("offline"); },
            saveCheckpointKeepalive: keepalive
        });
        await expect(service.flushForPageExit()).resolves.toBe(true);
        expect(keepalive).toHaveBeenCalledWith(expect.objectContaining({ uid: "u1" }), { latest: true }, expect.any(Number));
    });
});
