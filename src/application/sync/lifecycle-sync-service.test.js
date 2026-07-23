import { describe, expect, it, vi } from "vitest";
import { createLifecycleSyncService } from "./lifecycle-sync-service.js";

describe("lifecycle sync service", () => {
    it("fully persists before logout", async () => {
        const order = [];
        const service = createLifecycleSyncService({
            getSession: () => ({ user: { uid: "u1", isAnonymous: false }, payload: {} }),
            waitForUploads: async () => order.push("images"),
            persistLatest: async () => order.push("indexeddb"),
            flushFirebase: async () => order.push("firebase"),
            loadDurable: async () => ({ payload: { latest: true }, dirty: false }),
            saveCheckpoint: async () => order.push("cloudflare"),
            saveCheckpointKeepalive: vi.fn()
        });
        await service.flushBeforeLogout();
        expect(order).toEqual(["images", "indexeddb", "firebase", "cloudflare"]);
    });

    it("persists the latest payload before a hidden-page remote flush", async () => {
        const order = [];
        let persisted = false;
        const saveCheckpoint = vi.fn(async () => order.push("cloudflare"));
        const service = createLifecycleSyncService({
            getSession: () => ({
                user: { uid: "u1", isAnonymous: false },
                payload: { version: persisted ? "latest" : "stale" }
            }),
            waitForUploads: vi.fn(),
            persistLatest: async () => { order.push("indexeddb"); persisted = true; },
            flushFirebase: async () => order.push("firebase"),
            loadDurable: async () => ({ payload: { version: "latest" }, dirty: false }),
            saveCheckpoint,
            saveCheckpointKeepalive: vi.fn()
        });

        await expect(service.flushForPageExit()).resolves.toBe(true);
        expect(order).toEqual(["indexeddb", "firebase", "cloudflare"]);
        expect(saveCheckpoint).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "u1" }),
            { version: "latest" },
            expect.any(Number)
        );
    });

    it("shares one local persistence across overlapping exit events", async () => {
        let releasePersist;
        let persisted = false;
        const persistLatest = vi.fn(() => new Promise(resolve => {
            releasePersist = () => { persisted = true; resolve(); };
        }));
        const keepalive = vi.fn(() => true);
        const service = createLifecycleSyncService({
            getSession: () => ({
                user: { uid: "u1", isAnonymous: false },
                payload: { version: persisted ? "latest" : "stale" }
            }),
            waitForUploads: vi.fn(),
            persistLatest,
            flushFirebase: vi.fn(async () => {}),
            loadDurable: async () => ({ payload: { version: "latest" }, dirty: false }),
            saveCheckpoint: vi.fn(async () => {}),
            saveCheckpointKeepalive: keepalive
        });

        const hiddenFlush = service.flushForPageExit();
        const pageHideFlush = service.flushForPageExit({ keepaliveOnly: true });
        await vi.waitFor(() => expect(persistLatest).toHaveBeenCalledTimes(1));
        releasePersist();

        await expect(Promise.all([hiddenFlush, pageHideFlush])).resolves.toEqual([true, true]);
        expect(keepalive).toHaveBeenCalledWith(
            expect.objectContaining({ uid: "u1" }),
            { version: "latest" },
            expect.any(Number)
        );
    });

    it("identifies a Cloudflare checkpoint failure before logout", async () => {
        const service = createLifecycleSyncService({
            getSession: () => ({ user: { uid: "u1", isAnonymous: false }, payload: {} }),
            waitForUploads: vi.fn(),
            persistLatest: vi.fn(),
            flushFirebase: vi.fn(),
            loadDurable: async () => ({ payload: { latest: true }, dirty: false }),
            saveCheckpoint: async () => { throw new Error("NOT_FOUND"); },
            saveCheckpointKeepalive: vi.fn()
        });

        await expect(service.flushBeforeLogout()).rejects.toMatchObject({
            message: "NOT_FOUND",
            syncStage: "cloudflare-checkpoint"
        });
    });

    it("falls back to a keepalive checkpoint if the hidden flush fails", async () => {
        const keepalive = vi.fn(() => true);
        const service = createLifecycleSyncService({
            getSession: () => ({ user: { uid: "u1", isAnonymous: false }, payload: { latest: true } }),
            waitForUploads: vi.fn(), persistLatest: vi.fn(),
            flushFirebase: async () => { throw new Error("offline"); },
            loadDurable: vi.fn(), saveCheckpoint: vi.fn(), saveCheckpointKeepalive: keepalive
        });
        await expect(service.flushForPageExit()).resolves.toBe(true);
        expect(keepalive).toHaveBeenCalledWith(expect.objectContaining({ uid: "u1" }), { latest: true }, expect.any(Number));
    });
});
