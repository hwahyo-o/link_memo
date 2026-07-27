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
                revision: null,
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
        expect(remote.save).toHaveBeenCalledWith("user", expect.any(Object), {
            expectedRevision: null,
            previousChunkIds: ["old"]
        });
        expect(local.acknowledge).toHaveBeenCalledWith("user", "v1", "next", result.snapshot);
    });

    it("reloads and merges after a remote revision conflict before acknowledging", async () => {
        let state = {
            revision: "r0",
            chunkIds: ["r0_0"],
            snapshot: { files: [{ path: "base.md", content: "base", updatedAt: 1, mutationId: "base" }] }
        };
        let initialLoads = 0;
        let releaseInitialLoads;
        const bothLoaded = new Promise(resolve => { releaseInitialLoads = resolve; });
        const remote = {
            async load() {
                const captured = structuredClone(state);
                initialLoads += 1;
                if (initialLoads <= 2) {
                    if (initialLoads === 2) releaseInitialLoads();
                    await bothLoaded;
                }
                return captured;
            },
            async save(_userId, snapshot, { expectedRevision }) {
                if (expectedRevision !== state.revision) {
                    const error = new Error("PKM_REMOTE_REVISION_CHANGED");
                    error.code = "PKM_REMOTE_REVISION_CHANGED";
                    throw error;
                }
                state = {
                    revision: `r${Number(state.revision.slice(1)) + 1}`,
                    chunkIds: [],
                    snapshot: structuredClone(snapshot)
                };
                return { revision: state.revision };
            }
        };
        const createLocal = file => ({
            load: vi.fn(async () => ({ dirty: true, version: file.path, snapshot: { files: [file] } })),
            acknowledge: vi.fn(async () => true),
            savePending: vi.fn(),
            cache: vi.fn()
        });
        const localA = createLocal({ path: "A.md", content: "A", updatedAt: 2, mutationId: "A" });
        const localB = createLocal({ path: "B.md", content: "B", updatedAt: 2, mutationId: "B" });
        const scheduler = { schedule: vi.fn(), cancel: vi.fn() };
        const serviceA = createPkmSyncService({ localRepository: localA, remoteRepository: remote, scheduler });
        const serviceB = createPkmSyncService({ localRepository: localB, remoteRepository: remote, scheduler });

        const results = await Promise.all([serviceA.flush("user"), serviceB.flush("user")]);
        expect(results.every(result => result.synced)).toBe(true);
        expect(state.snapshot.files.map(file => file.path)).toEqual(["A.md", "B.md", "base.md"]);
        expect(localA.acknowledge).toHaveBeenCalledOnce();
        expect(localB.acknowledge).toHaveBeenCalledOnce();
    });
});
