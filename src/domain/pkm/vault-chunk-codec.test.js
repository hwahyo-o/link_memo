import { describe, expect, it } from "vitest";
import {
    decodeVaultFileChunks,
    encodeVaultFiles,
    MAX_VAULT_CHUNK_BYTES
} from "./vault-chunk-codec.js";

describe("PKM vault chunk codec", () => {
    it("round-trips a valid 1.2 MB file without creating an oversized Firestore document payload", () => {
        const files = [{
            path: "large.md",
            type: "md",
            content: "a".repeat(1_200_000),
            updatedAt: 1,
            mutationId: "large"
        }];
        const chunks = encodeVaultFiles(files);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every(chunk => new TextEncoder().encode(chunk).byteLength <= MAX_VAULT_CHUNK_BYTES)).toBe(true);
        expect(decodeVaultFileChunks(chunks.map(payloadPart => ({ payloadPart })))).toEqual(files);
    });

    it("preserves multibyte text and reads the legacy files-array format", () => {
        const files = [{ path: "한글.md", content: "메모🙂".repeat(100_000) }];
        const chunks = encodeVaultFiles(files);
        expect(decodeVaultFileChunks(chunks.map(payloadPart => ({ payloadPart })))).toEqual(files);
        expect(decodeVaultFileChunks([{ files }])).toEqual(files);
    });
});
