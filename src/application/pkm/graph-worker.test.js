import { describe, expect, it } from "vitest";
import { layoutGraph, parseMetadata } from "./graph-worker.js";

describe("PKM graph worker algorithms", () => {
    it("extracts searchable metadata and resolved wiki links", () => {
        expect(parseMetadata({
            path: "notes/source.md",
            content: "# 제목\n#태그\n<!-- 댓글 -->\n[[target]]"
        })).toMatchObject({
            title: "제목",
            tags: ["태그"],
            comments: ["댓글"],
            resolvedLinks: ["notes/target.md"]
        });
    });

    it("lays out 10,000 nodes without invalid positions", () => {
        const nodes = Array.from({ length: 10_000 }, (_, index) => ({ id: `n${index}` }));
        const edges = nodes.slice(1).map((node, index) => ({ source: `n${index}`, target: node.id }));
        const positions = layoutGraph(nodes, edges, 1);
        expect(positions).toHaveLength(10_000);
        expect(positions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    }, 10_000);

    it("bounds layout work even if a caller supplies more than 100,000 nodes", () => {
        const nodes = Array.from({ length: 100_100 }, (_, index) => ({ id: `n${index}` }));
        expect(layoutGraph(nodes, [], 0)).toHaveLength(100_000);
    });
});
