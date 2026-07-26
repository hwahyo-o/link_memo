import { describe, expect, it, vi } from "vitest";
import { createVault } from "./vault.js";

describe("PKM vault", () => {
    it("serializes concurrent edits for one path", async () => {
        const vault = createVault({ deviceId: "test" });
        await vault.write("notes/a.md", "initial");
        let release;
        const first = vault.process("notes/a.md", () => new Promise(resolve => {
            release = () => resolve("first");
        }));
        const second = vault.process("notes/a.md", current => current.content);
        await vi.waitFor(() => expect(typeof release).toBe("function"));
        release();
        await expect(first).resolves.toBe("first");
        await expect(second).resolves.toBe("initial");
        expect(vault.pending()).toBe(0);
    });

    it("keeps deletion tombstones", async () => {
        const vault = createVault({ deviceId: "test" });
        await vault.write("notes/a.md", "content");
        await vault.remove("notes/a.md");
        expect(vault.read("notes/a.md")).toBeNull();
        expect(vault.snapshot().files[0].deleted).toBe(true);
    });
});
