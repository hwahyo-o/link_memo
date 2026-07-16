import { describe, expect, it } from "vitest";
import { createMemoSyncService } from "./memo-sync-service.js";

describe("memo sync service", () => {
    it("acknowledges only the locally durable pending snapshot", async () => {
        const pending = { dirty: true, version: "v1", remoteRevision: 3, payload: { categories: ["업무"] } };
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
});
