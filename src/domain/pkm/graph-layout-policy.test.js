import { describe, expect, it } from "vitest";
import {
    GRAPH_LAYOUT_RULES,
    aabbSeparated,
    categorySeparationSatisfied,
    deriveCategoryGroupRadius,
    deriveInfluenceRadius,
    nearestParentSatisfied,
    parentDistanceLimit,
    parentEdgeAngleSeparated
} from "./graph-layout-policy.js";

describe("graph layout policy", () => {
    it("uses the requested minimums while preserving the existing preferred gap", () => {
        expect(GRAPH_LAYOUT_RULES.minimumNodeGap).toBe(42);
        expect(GRAPH_LAYOUT_RULES.preferredNodeGap).toBe(96);
        expect(GRAPH_LAYOUT_RULES.minimumCategoryCenterDistance).toBe(420);
    });

    it("measures node separation from the outer geometry", () => {
        const node = { width: 196, height: 72 };
        expect(aabbSeparated(node, node, { x: 0, y: 0 }, { x: 292, y: 0 }, 96)).toBe(true);
        expect(aabbSeparated(node, node, { x: 0, y: 0 }, { x: 291, y: 0 }, 96)).toBe(false);
    });

    it("derives a parent-centered influence radius from child geometry", () => {
        const parent = { width: 196, height: 72 };
        const child = { width: 174, height: 64 };
        expect(deriveInfluenceRadius(parent, [child])).toBeGreaterThan(420);
        expect(deriveInfluenceRadius(parent, [child, child])).toBeGreaterThan(deriveInfluenceRadius(parent, [child]));
    });


    it("requires the assigned parent to be strictly nearest among peers", () => {
        const candidate = { x: 0, y: 0 };
        const parent = { x: 80, y: 0 };
        const nearerPeer = { x: -60, y: 0 };
        const fartherPeer = { x: -120, y: 0 };
        expect(nearestParentSatisfied(candidate, parent, [fartherPeer])).toBe(true);
        expect(nearestParentSatisfied(candidate, parent, [nearerPeer])).toBe(false);
        expect(nearestParentSatisfied(candidate, parent, [{ x: -80, y: 0 }])).toBe(false);
    });

    it("bounds parent distances without violating geometry minimums", () => {
        const category = { width: 196, height: 72 };
        const subcategory = { width: 174, height: 64 };
        const item = { width: 188, height: 68 };
        expect(parentDistanceLimit(category, subcategory, "subcategory")).toBe(360);
        expect(parentDistanceLimit(subcategory, item, "item")).toBe(300);
        expect(deriveCategoryGroupRadius(category, [subcategory], new Map([
            ["subcategory", [item]]
        ])).toBeGreaterThan(700);
    });

    it("rejects same-parent edges that are too close in angle", () => {
        const parent = { x: 0, y: 0 };
        expect(parentEdgeAngleSeparated(
            { x: 100, y: 0 },
            parent,
            [{ x: 100, y: 5 }]
        )).toBe(false);
        expect(parentEdgeAngleSeparated(
            { x: 100, y: 0 },
            parent,
            [{ x: 0, y: 100 }]
        )).toBe(true);
    });

    it("rejects category influence overlap of 50px or more", () => {
        const left = { x: 0, y: 0 };
        const right = { x: 950, y: 0 };
        expect(categorySeparationSatisfied(left, right, left, right, 500, 500)).toBe(false);
        expect(categorySeparationSatisfied(left, right, left, { x: 951, y: 0 }, 500, 500)).toBe(true);
    });
});
