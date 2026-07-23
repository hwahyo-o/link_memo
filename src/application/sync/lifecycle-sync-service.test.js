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
