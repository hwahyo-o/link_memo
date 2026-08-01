import { describe, expect, it } from "vitest";
import { classifyLegacyGraphFiles, projectVaultGraph } from "./graph-projector.js";

describe("PKM graph projector", () => {
    it("does not turn unindexed legacy or manual files into gray graph nodes", () => {
        const files = [
            { path: "note.md", type: "md", content: "# Note" },
            { path: "old.canvas", type: "canvas", content: "{}" }
        ];
        expect(projectVaultGraph(files, []).nodes).toEqual([]);
    });

    it("deletes only confidently identified legacy importer output", () => {
        const legacy = { path: "Link Memo/공부/AI.md", type: "md", mutationId: "link-memo-import" };
        const edited = { ...legacy, path: "Link Memo/공부/편집.md", mutationId: "manual-edit" };
        const manual = { path: "내 지식/메모.md", type: "md", mutationId: "link-memo-import" };
        const result = classifyLegacyGraphFiles([legacy, edited, manual]);
        expect(result.safeToDelete).toEqual([legacy]);
        expect(result.preserveHidden).toEqual(expect.arrayContaining([edited, manual]));
    });
});
