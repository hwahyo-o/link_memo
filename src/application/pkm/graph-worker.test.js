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
        const nodes = Array.from({ length: 10_000 }, (_, index) => ({ id: `n${index}`, width: 188, height: 68 }));
        const edges = nodes.slice(1).map((node, index) => ({ source: `n${index}`, target: node.id }));
        const positions = layoutGraph(nodes, edges, 1);
        expect(positions).toHaveLength(10_000);
        expect(positions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    }, 10_000);

    it("packs real node rectangles without overlap", () => {
        const nodes = Array.from({ length: 400 }, (_, index) => ({
            id: `n${index}`,
            width: index % 3 === 0 ? 196 : 188,
            height: index % 3 === 0 ? 72 : 68
        }));
        const positions = layoutGraph(nodes, [], 2);
        const placed = positions.map((position, index) => ({ ...position, ...nodes[index] }));
        let minimumSeparatingGap = Infinity;
        for (let left = 0; left < placed.length; left += 1) {
            for (let right = left + 1; right < placed.length; right += 1) {
                const a = placed[left];
                const b = placed[right];
                const overlaps = Math.abs(a.x - b.x) < (a.width + b.width) / 2
                    && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
                expect(overlaps).toBe(false);
                const gapX = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
                const gapY = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
                minimumSeparatingGap = Math.min(minimumSeparatingGap, Math.max(gapX, gapY));
            }
        }
        expect(minimumSeparatingGap).toBeGreaterThanOrEqual(96);
    });

    it("places linked nodes as a force-directed network near their edges", () => {
        const nodes = [
            { id: "category", kind: "category", width: 196, height: 72 },
            { id: "subcategory", kind: "subcategory", width: 174, height: 64 },
            { id: "item", kind: "item", width: 188, height: 68 },
            { id: "orphan", kind: "item", width: 188, height: 68 }
        ];
        const positions = new Map(layoutGraph(nodes, [
            { source: "category", target: "subcategory", kind: "category-membership" },
            { source: "subcategory", target: "item", kind: "subcategory-membership" }
        ], 36).map(position => [position.id, position]));
        const distance = (left, right) => Math.hypot(positions.get(left).x - positions.get(right).x, positions.get(left).y - positions.get(right).y);
        expect(distance("category", "subcategory")).toBeLessThan(340);
        expect(distance("subcategory", "item")).toBeLessThan(340);
        expect(distance("category", "orphan")).toBeGreaterThan(500);
        expect(new Set([...positions.values()].map(position => Math.round(position.x))).size).toBeGreaterThan(2);
        expect(new Set([...positions.values()].map(position => Math.round(position.y))).size).toBeGreaterThan(2);
    });

    it("bounds layout work even if a caller supplies more than 100,000 nodes", () => {
        const nodes = Array.from({ length: 100_100 }, (_, index) => ({ id: `n${index}` }));
        expect(layoutGraph(nodes, [], 0)).toHaveLength(100_000);
    });
});
