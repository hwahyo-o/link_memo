import { describe, expect, it } from "vitest";
import { createMetadataCache } from "./metadata-cache.js";

function createWorker() {
    const listeners = new Map();
    const posted = [];
    return {
        posted,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        postMessage(message) {
            posted.push(message);
        },
        emit(type, data) {
            for (const listener of listeners.get(type) || []) listener({ data });
        }
    };
}

describe("PKM metadata cache", () => {
    it("keeps one active request and coalesces pending edits to the latest snapshot", async () => {
        const worker = createWorker();
        const cache = createMetadataCache({ worker });
        const first = cache.index([{ path: "first.md", content: "first" }]);
        const second = cache.index([{ path: "second.md", content: "second" }]);
        const third = cache.index([{ path: "latest.md", content: "latest" }]);

        expect(worker.posted).toHaveLength(1);
        worker.emit("message", {
            type: "metadata-result",
            requestId: worker.posted[0].requestId,
            entries: [{ path: "first.md", content: "first" }]
        });
        await expect(first).resolves.toEqual([{ path: "first.md", content: "first" }]);
        expect(worker.posted).toHaveLength(2);
        expect(worker.posted[1].files[0].path).toBe("latest.md");

        worker.emit("message", {
            type: "metadata-result",
            requestId: worker.posted[1].requestId,
            entries: [{ path: "latest.md", content: "latest" }]
        });
        await expect(Promise.all([second, third])).resolves.toEqual([
            [{ path: "latest.md", content: "latest" }],
            [{ path: "latest.md", content: "latest" }]
        ]);
    });

    it("detaches stale work when the authenticated workspace is cleared", async () => {
        const worker = createWorker();
        const cache = createMetadataCache({ worker });
        const stale = cache.index([{ path: "old.md", content: "old" }]);
        cache.clear();
        await expect(stale).resolves.toEqual([]);
        const current = cache.index([{ path: "new.md", content: "new" }]);
        expect(worker.posted).toHaveLength(2);
        worker.emit("message", {
            type: "metadata-result",
            requestId: worker.posted[1].requestId,
            entries: [{ path: "new.md", content: "new" }]
        });
        await expect(current).resolves.toEqual([{ path: "new.md", content: "new" }]);
    });
});
