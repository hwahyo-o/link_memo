import { describe, expect, it } from "vitest";
import { CONTENT_KIND_COLORS, deriveNodeVisualState } from "./graph-node-policy.js";

const visual = overrides => deriveNodeVisualState({
    searchActive: false,
    match: "none",
    hasSelection: false,
    selected: false,
    color: "#FF9797",
    ...overrides
});

describe("graph node policy", () => {
    it("keeps the three image combinations unique", () => {
        expect(CONTENT_KIND_COLORS.image).toBe("#FF9797");
        expect(CONTENT_KIND_COLORS["link-image"]).toBe("#FFA374");
        expect(CONTENT_KIND_COLORS["link-image-text"]).toBe("#DE6863");
        expect(new Set(Object.values(CONTENT_KIND_COLORS)).size).toBe(Object.keys(CONTENT_KIND_COLORS).length);
    });

    it("applies selection without a query", () => {
        expect(visual({ selected: true, hasSelection: true })).toMatchObject({ opacity: 1, shadowOpacity: 0.58 });
        expect(visual({ hasSelection: true })).toMatchObject({ opacity: 0.7, shadowOpacity: 0 });
    });

    it.each([
        ["direct", false, 1, "#2563EB"],
        ["direct", true, 0.85, "#2563EB"],
        ["context", false, 0.85, "#38BDF8"],
        ["context", true, 0.7, "#38BDF8"]
    ])("applies %s search state", (match, hasSelection, opacity, borderColor) => {
        expect(visual({ searchActive: true, match, hasSelection })).toMatchObject({ opacity, borderColor, borderWidth: 3, layer: "above" });
    });

    it("raises a selected non-match and restores it below the dim layer after deselection", () => {
        expect(visual({ searchActive: true, selected: true, hasSelection: true })).toMatchObject({ opacity: 1, layer: "above", borderColor: "#FF9797", shadowOpacity: 0.62 });
        expect(visual({ searchActive: true })).toMatchObject({ opacity: 0.7, layer: "below", shadowOpacity: 0 });
        expect(visual({ searchActive: true, hasSelection: true })).toMatchObject({ opacity: 0.7, layer: "above", shadowOpacity: 0 });
    });
});
