const NODE_TYPES = new Set(["text", "file", "link", "group"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);
export const MAX_CANVAS_NODES = 10_000;
export const MAX_CANVAS_EDGES = 50_000;

function requiredString(value, field) {
    if (typeof value !== "string" || !value) throw new Error(`INVALID_CANVAS_${field.toUpperCase()}`);
    return value;
}

function requiredInteger(value, field) {
    if (!Number.isInteger(value)) throw new Error(`INVALID_CANVAS_${field.toUpperCase()}`);
    return value;
}

function parseNode(value) {
    const type = requiredString(value?.type, "node_type");
    if (!NODE_TYPES.has(type)) throw new Error("INVALID_CANVAS_NODE_TYPE");
    const node = {
        id: requiredString(value.id, "node_id"),
        type,
        x: requiredInteger(value.x, "node_x"),
        y: requiredInteger(value.y, "node_y"),
        width: requiredInteger(value.width, "node_width"),
        height: requiredInteger(value.height, "node_height")
    };
    if (value.color !== undefined) node.color = String(value.color);
    if (type === "text") {
        if (typeof value.text !== "string") throw new Error("INVALID_CANVAS_NODE_TEXT");
        node.text = value.text;
    }
    if (type === "file") {
        node.file = requiredString(value.file, "node_file");
        if (value.subpath !== undefined) node.subpath = String(value.subpath);
    }
    if (type === "link") node.url = requiredString(value.url, "node_url");
    if (type === "group") {
        if (value.label !== undefined) node.label = String(value.label);
        if (value.background !== undefined) node.background = String(value.background);
        if (["cover", "ratio", "repeat"].includes(value.backgroundStyle)) node.backgroundStyle = value.backgroundStyle;
    }
    return node;
}

function parseEdge(value) {
    const edge = {
        id: requiredString(value?.id, "edge_id"),
        fromNode: requiredString(value?.fromNode, "edge_from_node"),
        toNode: requiredString(value?.toNode, "edge_to_node"),
        fromEnd: ENDS.has(value?.fromEnd) ? value.fromEnd : "none",
        toEnd: ENDS.has(value?.toEnd) ? value.toEnd : "arrow"
    };
    if (SIDES.has(value?.fromSide)) edge.fromSide = value.fromSide;
    if (SIDES.has(value?.toSide)) edge.toSide = value.toSide;
    if (value?.color !== undefined) edge.color = String(value.color);
    if (value?.label !== undefined) edge.label = String(value.label);
    return edge;
}

export function parseJsonCanvas(input) {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON_CANVAS");
    const rawNodes = value.nodes || [];
    const rawEdges = value.edges || [];
    if (!Array.isArray(rawNodes) || rawNodes.length > MAX_CANVAS_NODES) throw new Error("CANVAS_NODE_LIMIT_EXCEEDED");
    if (!Array.isArray(rawEdges) || rawEdges.length > MAX_CANVAS_EDGES) throw new Error("CANVAS_EDGE_LIMIT_EXCEEDED");
    const nodes = rawNodes.map(parseNode);
    const nodeIds = new Set(nodes.map(node => node.id));
    if (nodeIds.size !== nodes.length) throw new Error("DUPLICATE_CANVAS_NODE_ID");
    const edges = rawEdges.map(parseEdge);
    if (new Set(edges.map(edge => edge.id)).size !== edges.length) throw new Error("DUPLICATE_CANVAS_EDGE_ID");
    if (edges.some(edge => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))) throw new Error("CANVAS_EDGE_NODE_MISSING");
    return { nodes, edges };
}
