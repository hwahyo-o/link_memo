import { describe, expect, it } from "vitest";
import { layoutGraph, parseMetadata } from "./graph-worker.js";
import { GRAPH_LAYOUT_RULES, aabbEnvelopeSeparated, aabbSeparated, categoryOwnershipSatisfied, categoryRegionContains, categorySeparationSatisfied, deriveCategoryGroupEnvelope, deriveCategoryGroupRadius, deriveInfluenceRadius, hierarchyBandSatisfied } from "../../domain/pkm/graph-layout-policy.js";

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
        expect(minimumSeparatingGap).toBeGreaterThanOrEqual(42);
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

        const categoryEnvelopeA = deriveCategoryGroupEnvelope(
            byId.get("category-a"),
            [byId.get("subcategory-a"), byId.get("item-a")],
            positions
        );
        const categoryEnvelopeB = deriveCategoryGroupEnvelope(
            byId.get("category-b"),
            [byId.get("subcategory-b"), byId.get("item-b")],
            positions
        );
        expect(categoryEnvelopeA).not.toBeNull();
        expect(categoryEnvelopeB).not.toBeNull();
        expect(aabbEnvelopeSeparated(categoryEnvelopeA, categoryEnvelopeB)).toBe(true);
        expect(aabbSeparated(
            byId.get("category-a"),
            byId.get("category-b"),
            get("category-a"),
            get("category-b")
        )).toBe(true);

        expect(distance("category-a", "subcategory-a")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("category-a"), [byId.get("subcategory-a")]));
        expect(distance("category-a", "subcategory-a")).toBeLessThanOrEqual(GRAPH_LAYOUT_RULES.maximumSubcategoryDistance);
        expect(distance("category-b", "subcategory-b")).toBeLessThanOrEqual(GRAPH_LAYOUT_RULES.maximumSubcategoryDistance);
        expect(distance("subcategory-a", "item-a")).toBeLessThanOrEqual(GRAPH_LAYOUT_RULES.maximumItemDistance + 1e-6);
        expect(distance("subcategory-b", "item-b")).toBeLessThanOrEqual(GRAPH_LAYOUT_RULES.maximumItemDistance + 1e-6);
        expect(distance("category-b", "subcategory-b")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("category-b"), [byId.get("subcategory-b")]));
        expect(distance("subcategory-a", "item-a")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("subcategory-a"), [byId.get("item-a")]));
        expect(distance("subcategory-b", "item-b")).toBeLessThanOrEqual(deriveInfluenceRadius(byId.get("subcategory-b"), [byId.get("item-b")]));

        expect(distance("subcategory-a", "category-a")).toBeLessThan(distance("subcategory-a", "category-b"));
        expect(distance("subcategory-b", "category-b")).toBeLessThan(distance("subcategory-b", "category-a"));
        expect(distance("item-a", "subcategory-a")).toBeLessThan(distance("item-a", "subcategory-b"));
        expect(distance("item-b", "subcategory-b")).toBeLessThan(distance("item-b", "subcategory-a"));

        for (let left = 0; left < nodes.length; left += 1) {
            for (let right = left + 1; right < nodes.length; right += 1) {
                expect(aabbSeparated(nodes[left], nodes[right], get(nodes[left].id), get(nodes[right].id))).toBe(true);
            }
        }
    });


    it("keeps hierarchy levels ordered outward from the canvas center", () => {
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
        const bounds = nodes.reduce((current, node) => {
            const position = positions.get(node.id);
            return {
                minX: Math.min(current.minX, position.x - node.width / 2),
                minY: Math.min(current.minY, position.y - node.height / 2),
                maxX: Math.max(current.maxX, position.x + node.width / 2),
                maxY: Math.max(current.maxY, position.y + node.height / 2)
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const center = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
        expect(center.x).toBeCloseTo(0, 5);
        expect(center.y).toBeCloseTo(0, 5);
        const radius = id => Math.hypot(
            positions.get(id).x - center.x,
            positions.get(id).y - center.y
        );
        const categories = ["category-a", "category-b"];
        const subcategories = ["subcategory-a", "subcategory-b"];
        const items = ["item-a", "item-b"];
        const categoryBand = Math.max(...categories.map(radius));
        const subcategoryBand = Math.max(...subcategories.map(radius));
        expect(subcategoryBand).toBeGreaterThan(categoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap);
        expect(Math.min(...items.map(radius))).toBeGreaterThan(subcategoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap);

        const distance = (left, right) => Math.hypot(
            positions.get(left).x - positions.get(right).x,
            positions.get(left).y - positions.get(right).y
        );
        expect(distance("subcategory-a", "category-a")).toBeLessThan(distance("subcategory-a", "category-b"));
        expect(distance("subcategory-b", "category-b")).toBeLessThan(distance("subcategory-b", "category-a"));
        expect(distance("item-a", "subcategory-a")).toBeLessThan(distance("item-a", "subcategory-b"));
        expect(distance("item-b", "subcategory-b")).toBeLessThan(distance("item-b", "subcategory-a"));
    });

    it("separates same-parent hierarchy edges into distinct radial directions", () => {
        const nodes = [
            { id: "category", kind: "category", width: 196, height: 72 },
            { id: "subcategory-a", kind: "subcategory", categoryId: "category", width: 174, height: 64 },
            { id: "subcategory-b", kind: "subcategory", categoryId: "category", width: 174, height: 64 },
            { id: "item-a", kind: "item", subcategoryId: "subcategory-a", width: 188, height: 68 },
            { id: "item-b", kind: "item", subcategoryId: "subcategory-a", width: 188, height: 68 }
        ];
        const edges = [
            { source: "category", target: "subcategory-a", kind: "category-membership" },
            { source: "category", target: "subcategory-b", kind: "category-membership" },
            { source: "subcategory-a", target: "item-a", kind: "subcategory-membership" },
            { source: "subcategory-a", target: "item-b", kind: "subcategory-membership" }
        ];
        const positions = new Map(layoutGraph(nodes, edges, 36).map(position => [position.id, position]));
        const angle = (parent, child) => Math.atan2(
            positions.get(child).y - positions.get(parent).y,
            positions.get(child).x - positions.get(parent).x
        );
        const angularDistance = (left, right) => {
            const distance = Math.abs(left - right) % (Math.PI * 2);
            return Math.min(distance, Math.PI * 2 - distance);
        };

        expect(angularDistance(
            angle("category", "subcategory-a"),
            angle("category", "subcategory-b")
        )).toBeGreaterThanOrEqual(GRAPH_LAYOUT_RULES.minimumSiblingEdgeAngle);
        expect(angularDistance(
            angle("subcategory-a", "item-a"),
            angle("subcategory-a", "item-b")
        )).toBeGreaterThanOrEqual(GRAPH_LAYOUT_RULES.minimumSiblingEdgeAngle);
    });

    it("keeps each category region layered and item nodes outward from their subcategory", () => {
        const nodes = [
            { id: "category-a", kind: "category", width: 196, height: 72 },
            { id: "category-b", kind: "category", width: 196, height: 72 },
            { id: "subcategory-a1", kind: "subcategory", categoryId: "category-a", width: 174, height: 64 },
            { id: "subcategory-a2", kind: "subcategory", categoryId: "category-a", width: 174, height: 64 },
            { id: "subcategory-b1", kind: "subcategory", categoryId: "category-b", width: 174, height: 64 },
            { id: "item-a1", kind: "item", subcategoryId: "subcategory-a1", width: 188, height: 68 },
            { id: "item-a2", kind: "item", subcategoryId: "subcategory-a2", width: 188, height: 68 },
            { id: "item-b1", kind: "item", subcategoryId: "subcategory-b1", width: 188, height: 68 }
        ];
        const edges = [
            { source: "category-a", target: "subcategory-a1", kind: "category-membership" },
            { source: "category-a", target: "subcategory-a2", kind: "category-membership" },
            { source: "category-b", target: "subcategory-b1", kind: "category-membership" },
            { source: "subcategory-a1", target: "item-a1", kind: "subcategory-membership" },
            { source: "subcategory-a2", target: "item-a2", kind: "subcategory-membership" },
            { source: "subcategory-b1", target: "item-b1", kind: "subcategory-membership" }
        ];
        const positions = new Map(layoutGraph(nodes, edges, 36).map(position => [position.id, position]));
        const byId = new Map(nodes.map(node => [node.id, node]));
        const distance = (left, right) => Math.hypot(
            positions.get(left).x - positions.get(right).x,
            positions.get(left).y - positions.get(right).y
        );
        const categoryA = positions.get("category-a");
        const categoryB = positions.get("category-b");
        const regionRadius = deriveCategoryGroupRadius(
            byId.get("category-a"),
            [byId.get("subcategory-a1"), byId.get("subcategory-a2")],
            new Map([
                ["subcategory-a1", [byId.get("item-a1")]],
                ["subcategory-a2", [byId.get("item-a2")]]
            ])
        );

        for (const subcategoryId of ["subcategory-a1", "subcategory-a2"]) {
            expect(distance(subcategoryId, "category-a")).toBeLessThan(distance(subcategoryId, "category-b"));
            expect(categoryRegionContains(
                positions.get(subcategoryId),
                byId.get(subcategoryId),
                categoryA,
                regionRadius
            )).toBe(true);
        }
        expect(distance("item-a1", "subcategory-a1")).toBeLessThan(distance("item-a1", "subcategory-a2"));
        expect(distance("item-a2", "subcategory-a2")).toBeLessThan(distance("item-a2", "subcategory-a1"));
        for (const [itemId, subcategoryId] of [["item-a1", "subcategory-a1"], ["item-a2", "subcategory-a2"]]) {
            expect(hierarchyBandSatisfied(
                byId.get(itemId),
                positions.get(itemId),
                positions.get(subcategoryId),
                categoryA,
                "item"
            )).toBe(true);
            expect(categoryOwnershipSatisfied(
                positions.get(itemId),
                byId.get(itemId),
                categoryA,
                regionRadius,
                [{ position: categoryB, radius: regionRadius }]
            )).toBe(true);
        }
    });

    it("keeps a dense item family separated with geometry-aware multi-ring placement", () => {
        const nodes = [
            { id: "category", kind: "category", width: 196, height: 72 },
            { id: "subcategory", kind: "subcategory", categoryId: "category", width: 174, height: 64 },
            ...Array.from({ length: 120 }, (_, index) => ({
                id: `item-${index}`,
                kind: "item",
                subcategoryId: "subcategory",
                width: index % 2 ? 188 : 196,
                height: index % 2 ? 68 : 72
            }))
        ];
        const edges = [
            { source: "category", target: "subcategory", kind: "category-membership" },
            ...nodes.slice(2).map(node => ({
                source: "subcategory",
                target: node.id,
                kind: "subcategory-membership"
            }))
        ];
        const positions = new Map(layoutGraph(nodes, edges, 0).map(position => [position.id, position]));
        expect([...positions.values()].every(position => (
            Number.isFinite(position.x) && Number.isFinite(position.y)
        ))).toBe(true);
        for (let left = 0; left < nodes.length; left += 1) {
            for (let right = left + 1; right < nodes.length; right += 1) {
                expect(aabbSeparated(
                    nodes[left],
                    nodes[right],
                    positions.get(nodes[left].id),
                    positions.get(nodes[right].id)
                )).toBe(true);
            }
        }
    });

    it("keeps mixed item types in the outer radial band", () => {
        const contentKinds = ["link", "image", "text", "file"];
        const nodes = [
            { id: "category-a", kind: "category", width: 196, height: 72 },
            { id: "category-b", kind: "category", width: 196, height: 72 },
            { id: "subcategory-a", kind: "subcategory", categoryId: "category-a", width: 174, height: 64 },
            { id: "subcategory-b", kind: "subcategory", categoryId: "category-b", width: 174, height: 64 },
            ...Array.from({ length: 24 }, (_, index) => ({
                id: `item-${index}`,
                kind: "item",
                contentKind: contentKinds[index % contentKinds.length],
                subcategoryId: index % 2 ? "subcategory-a" : "subcategory-b",
                width: 188,
                height: 68
            }))
        ];
        const edges = [
            { source: "category-a", target: "subcategory-a", kind: "category-membership" },
            { source: "category-b", target: "subcategory-b", kind: "category-membership" },
            ...nodes.slice(4).map(node => ({
                source: node.subcategoryId,
                target: node.id,
                kind: "subcategory-membership"
            }))
        ];
        const positions = new Map(layoutGraph(nodes, edges, 0).map(position => [position.id, position]));
        const bounds = nodes.reduce((current, node) => {
            const position = positions.get(node.id);
            return {
                minX: Math.min(current.minX, position.x - node.width / 2),
                minY: Math.min(current.minY, position.y - node.height / 2),
                maxX: Math.max(current.maxX, position.x + node.width / 2),
                maxY: Math.max(current.maxY, position.y + node.height / 2)
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const center = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
        const radius = id => Math.hypot(
            positions.get(id).x - center.x,
            positions.get(id).y - center.y
        );
        const categoryBand = Math.max(radius("category-a"), radius("category-b"));
        const subcategoryBand = Math.max(radius("subcategory-a"), radius("subcategory-b"));
        const itemBand = Math.min(...nodes.slice(4).map(node => radius(node.id)));
        console.log("DEBUG_MIXED_BANDS", { center, categoryBand, subcategoryBand, itemBand });
        expect(subcategoryBand).toBeGreaterThan(categoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap);
        expect(itemBand).toBeGreaterThan(subcategoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap);
    });

    it("keeps every item type in the outer band, including unparented items", () => {
        const contentKinds = ["link", "image", "text", "file"];
        const nodes = [
            ...Array.from({ length: 3 }, (_, index) => ({
                id: `category-${index}`,
                kind: "category",
                width: 196,
                height: 72
            })),
            ...Array.from({ length: 6 }, (_, index) => ({
                id: `subcategory-${index}`,
                kind: "subcategory",
                categoryId: `category-${Math.floor(index / 2)}`,
                width: 174,
                height: 64
            })),
            ...Array.from({ length: 36 }, (_, index) => ({
                id: `item-${index}`,
                kind: "item",
                contentKind: contentKinds[index % contentKinds.length],
                ...(index < 24 ? { subcategoryId: `subcategory-${index % 6}` } : {}),
                width: 188,
                height: 68
            }))
        ];
        const edges = [
            ...nodes
                .filter(node => node.kind === "subcategory")
                .map(node => ({
                    source: node.categoryId,
                    target: node.id,
                    kind: "category-membership"
                })),
            ...nodes
                .filter(node => node.kind === "item" && node.subcategoryId)
                .map(node => ({
                    source: node.subcategoryId,
                    target: node.id,
                    kind: "subcategory-membership"
                }))
        ];
        const positions = new Map(layoutGraph(nodes, edges, 0).map(position => [position.id, position]));
        const bounds = nodes.reduce((current, node) => {
            const position = positions.get(node.id);
            return {
                minX: Math.min(current.minX, position.x - node.width / 2),
                minY: Math.min(current.minY, position.y - node.height / 2),
                maxX: Math.max(current.maxX, position.x + node.width / 2),
                maxY: Math.max(current.maxY, position.y + node.height / 2)
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const center = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };
        const radius = id => Math.hypot(
            positions.get(id).x - center.x,
            positions.get(id).y - center.y
        );
        const categories = nodes.filter(node => node.kind === "category");
        const subcategories = nodes.filter(node => node.kind === "subcategory");
        const items = nodes.filter(node => node.kind === "item");
        const categoryBand = Math.max(...categories.map(node => radius(node.id)));
        const subcategoryBand = Math.max(...subcategories.map(node => radius(node.id)));
        expect(subcategoryBand).toBeGreaterThan(categoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap);
        expect(Math.min(...items.map(node => radius(node.id)))).toBeGreaterThan(
            subcategoryBand + GRAPH_LAYOUT_RULES.minimumRadialBandGap
        );

        for (let left = 0; left < nodes.length; left += 1) {
            for (let right = left + 1; right < nodes.length; right += 1) {
                expect(aabbSeparated(
                    nodes[left],
                    nodes[right],
                    positions.get(nodes[left].id),
                    positions.get(nodes[right].id)
                )).toBe(true);
            }
        }
    });

    it("bounds layout work even if a caller supplies more than 100,000 nodes", () => {
        const nodes = Array.from({ length: 100_100 }, (_, index) => ({ id: `n${index}` }));
        expect(layoutGraph(nodes, [], 0)).toHaveLength(100_000);
    });
});
