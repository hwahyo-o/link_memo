import { describe, expect, it } from "vitest";
import { createMemoSyncService } from "./memo-sync-service.js";

function createPending(version = "v1") {
    return { dirty: true, version, remoteRevision: 3, payload: { categories: ["업무"] } };
}

describe("memo sync service", () => {
    it("acknowledges only the locally durable pending snapshot", async () => {
        const pending = createPending();
        const acknowledgements = [];
        const service = createMemoSyncService({
            localRepository: {
                load: async () => pending,
                acknowledge: async (_userId, version, revision) => {
                    acknowledgements.push({ version, revision });
                    return true;
                }
            },
            remoteRepository: {
                save: async (_userId, payload, options) => {
                    expect(payload).toEqual(pending.payload);
                    expect(options.expectedRevision).toBe(3);
                    return { revision: 4 };
                }
            }
        });

        service.setRevision(3);
        await expect(service.flush("user-1")).resolves.toEqual({ synced: true, revision: 4 });
        expect(acknowledgements).toEqual([{ version: "v1", revision: 4 }]);
    });

    it("keeps the local snapshot pending instead of overwriting another device after a conflict", async () => {
        const pending = createPending();
        const expectedRevisions = [];
        const service = createMemoSyncService({
            localRepository: { load: async () => pending, acknowledge: async () => true },
            remoteRepository: {
                save: async (_userId, _payload, options) => {
                    expectedRevisions.push(options.expectedRevision);
                    const error = new Error("MEMO_CONFLICT");
                    error.code = "MEMO_CONFLICT";
                    throw error;
                }
            }
        });

        await expect(service.flush("user-1")).rejects.toMatchObject({ code: "MEMO_CONFLICT" });
        expect(expectedRevisions).toEqual([3]);
    });

    it("keeps a failed snapshot pending for later recovery", async () => {
        const pending = createPending();
        const service = createMemoSyncService({
            localRepository: { load: async () => pending, acknowledge: async () => true },
            remoteRepository: {
                save: async () => {
                    const error = new Error("MEMO_CONFLICT");
                    error.code = "MEMO_CONFLICT";
                    throw error;
                }
            },
            onError: () => {}
        });

        await expect(service.flush("user-1")).rejects.toMatchObject({ code: "MEMO_CONFLICT" });
    });
});

