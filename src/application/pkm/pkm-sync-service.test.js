import { describe, expect, it, vi } from "vitest";
import { createPkmSyncService } from "./pkm-sync-service.js";

describe("PKM sync service", () => {
    it("merges remote and local files before acknowledgement", async () => {
        const local = {
            load: vi.fn(async () => ({
                dirty: true,
                version: "v1",
                snapshot: { files: [{ path: "local.md", content: "local", updatedAt: 2, mutationId: "l" }] }
            })),
            savePending: vi.fn(),
            acknowledge: vi.fn(async () => true),
            cache: vi.fn()
        };
        const remote = {
            load: vi.fn(async () => ({
                chunkIds: ["old"],
                snapshot: { files: [{ path: "remote.md", content: "remote", updatedAt: 1, mutationId: "r" }] }
            })),
            save: vi.fn(async () => ({ revision: "next" }))
        };
        const service = createPkmSyncService({
            localRepository: local,
            remoteRepository: remote,
            scheduler: { schedule: vi.fn(), cancel: vi.fn() }
        });
        const result = await service.flush("user");
        expect(result.snapshot.files.map(file => file.path)).toEqual(["local.md", "remote.md"]);
        expect(remote.save).toHaveBeenCalledWith("user", expect.any(Object), { previousChunkIds: ["old"] });
        expect(local.acknowledge).toHaveBeenCalledWith("user", "v1", "next", result.snapshot);
    });
});
