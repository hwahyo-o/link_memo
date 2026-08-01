export const CONTENT_KIND_COLORS = Object.freeze({
    text: "#CBEFFF",
    link: "#F8D374",
    image: "#FF9797",
    "link-image": "#FFA374",
    "link-text": "#82CFFD",
    "image-text": "#8ED2CD",
    "link-image-text": "#DE6863"
});

export const NODE_GEOMETRY = Object.freeze({
    category: Object.freeze({ width: 196, height: 72 }),
    subcategory: Object.freeze({ width: 174, height: 64 }),
    item: Object.freeze({ width: 188, height: 68 })
});

export const nodeGeometry = kind => NODE_GEOMETRY[kind] || NODE_GEOMETRY.item;

export function deriveNodeVisualState({ searchActive, match = "none", hasSelection, selected, color }) {
    const state = {
        opacity: 1,
        layer: "above",
        borderWidth: 1,
        borderColor: "#94A3B8",
        shadowColor: color,
        shadowOpacity: 0
    };

    if (!searchActive) {
        if (selected) state.shadowOpacity = 0.58;
        else if (hasSelection) state.opacity = 0.7;
        return state;
    }

    if (selected) {
        state.borderWidth = 3;
        state.borderColor = color;
        state.shadowOpacity = 0.62;
        return state;
    }

    if (match === "direct") {
        state.opacity = hasSelection ? 0.85 : 1;
        state.borderWidth = 3;
        state.borderColor = "#2563EB";
        return state;
    }
    if (match === "context") {
        state.opacity = hasSelection ? 0.7 : 0.85;
        state.borderWidth = 3;
        state.borderColor = "#38BDF8";
        return state;
    }

    state.opacity = 0.7;
    state.layer = hasSelection ? "above" : "below";
    return state;
}
