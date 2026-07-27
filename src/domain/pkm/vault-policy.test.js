import { describe, expect, it } from "vitest";
import {
    MAX_VAULT_CLOCK_SKEW_MS,
    MAX_VAULT_FILE_BYTES,
    mergeVaultSnapshots,
    normalizeVaultPath
} from "./vault-policy.js";

describe("PKM vault policy", () => {
    it("rejects overlong paths instead of collapsing distinct paths", () => {
        const prefix = "a".repeat(512);
        expect(() => normalizeVaultPath(`${prefix}x`)).toThrow("VAULT_PATH_TOO_LONG");
        expect(() => normalizeVaultPath(`${prefix}y`)).toThrow("VAULT_PATH_TOO_LONG");
    });

    it("bounds remote clocks and file payloads", () => {
        const now = Date.now();
        const snapshot = mergeVaultSnapshots(null, {
            updatedAt: Number.MAX_VALUE,
            files: [{
                path: "note.md",
                content: "ok",
                updatedAt: Number.MAX_VALUE,
                mutationId: "remote"
            }]
        });
        expect(snapshot.files[0].updatedAt).toBeLessThanOrEqual(now + MAX_VAULT_CLOCK_SKEW_MS + 50);
        expect(snapshot.updatedAt).toBeLessThanOrEqual(now + MAX_VAULT_CLOCK_SKEW_MS + 50);
        expect(() => mergeVaultSnapshots(null, {
            files: [{ path: "large.md", content: "a".repeat(MAX_VAULT_FILE_BYTES + 1) }]
        })).toThrow("VAULT_FILE_TOO_LARGE");
    });
});
