import { describe, expect, it } from "vitest";
import { layoutGraph, parseMetadata } from "./graph-worker.js";
import { aabbSeparated, categorySeparationSatisfied, deriveInfluenceRadius } from "../../domain/pkm/graph-layout-policy.js";

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
        expect(distance("category", "subcategory")).toBeLessThan(500);
        expect(distance("subcategory", "item")).toBeLessThan(500);
        expect(distance("category", "orphan")).toBeGreaterThan(500);
        expect(new Set([...positions.values()].map(position => Math.round(position.x))).size).toBeGreaterThan(2);
        expect(new Set([...positions.values()].map(position => Math.round(position.y))).size).toBeGreaterThan(2);
    });

    it("keeps hierarchical nodes near their parent without entering the parent shape", () => {
        const nodes = [
            { id: "category-a", kind: "category", width: 196, height: 72 },
            { id: "category-b", kind: "category", width: 196, height: 72 },
            { id: "subcategory-a", kind: "subcategory", categoryId: "category-a", width: 174, height: 64 },
            { id: "subcategory-b", kind: "subcategory", categoryId: "category-b", width: 174, height: 64 },
            { id: "item-a", kind: "item", subcategoryId: "subcategory-a", width: 188, height: 68 },
            { id: "item-b", kind: "item", subcategoryId: "subcategory-b", width: 188, height: 68 }
        ];
        const edges = [
            { source: "category-a", target: "subcategory-a", kind: "category-membership" },
            { source: "category-b", target: "subcategory-b", kind: "category-membership" },
            { source: "subcategory-a", target: "item-a", kind: "subcategory-membership" },
            { source: "subcategory-b", target: "item-b", kind: "subcategory-membership" }
        ];
        const positions = new Map(layoutGraph(nodes, edges, 36).map(position => [position.id, position]));
        const get = id => positions.get(id);
        const distance = (left, right) => Math.hypot(get(left).x - get(right).x, get(left).y - get(right).y);
        const byId = new Map(nodes.map(node => [node.id, node]));

        expect(distance("category-a", "category-b")).toBeGreaterThanOrEqual(420);
        expect(categorySeparationSatisfied(
            byId.get("category-a"),
            byId.get("category-b"),
            get("category-a"),
            get("category-b"),
            deriveInfluenceRadius(byId.get("category-a"), [byId.get("subcategory-a")]),
            deriveInfluenceRadius(byId.get("category-b"), [byId.get("subcategory-b")])
        )).toBe(true);
        expect(distance("category-a", "subcategory-a")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("category-a"), [byId.get("subcategory-a")]));
        expect(distance("category-b", "subcategory-b")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("category-b"), [byId.get("subcategory-b")]));
        expect(distance("subcategory-a", "item-a")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("subcategory-a"), [byId.get("item-a")]));
        expect(distance("subcategory-b", "item-b")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("subcategory-b"), [byId.get("item-b")]));

        for (let left = 0; left < nodes.length; left += 1) {
            for (let right = left + 1; right < nodes.length; right += 1) {
                expect(aabbSeparated(nodes[left], nodes[right], get(nodes[left].id), get(nodes[right].id))).toBe(true);
            }
        }
    });

    it("bounds layout work even if a caller supplies more than 100,000 nodes", () => {
        const nodes = Array.from({ length: 100_100 }, (_, index) => ({ id: `n${index}` }));
        expect(layoutGraph(nodes, [], 0)).toHaveLength(100_000);
    });
});
