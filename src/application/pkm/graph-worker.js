import { layoutIterationsFor, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";

function normalizePath(path) {
    return String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function resolveWikiLink(sourcePath, target) {
    const clean = normalizePath(target.split("#")[0].trim());
    if (!clean) return null;
    const withExtension = /\.[a-z0-9]+$/i.test(clean) ? clean : `${clean}.md`;
    if (withExtension.includes("/")) return withExtension;
    const parent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
    return `${parent}${withExtension}`;
}

export function parseMetadata(file) {
    const content = String(file.content || "");
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.path.split("/").pop().replace(/\.[^.]+$/, "");
    const tags = [...content.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => match[2]);
    const comments = [...content.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1].trim());
    const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1].trim());
    const urls = [...content.matchAll(/https?:\/\/[^\s<>)\]]+/g)].map(match => match[0]);
    return {
        path: file.path, title, content, tags, comments,
        links: [...links, ...urls],
        resolvedLinks: links.map(link => resolveWikiLink(file.path, link)).filter(Boolean)
    };
}

const kindRank = kind => kind === "category" ? 0 : kind === "subcategory" ? 1 : kind === "item" ? 2 : 3;

function nodeDepths(nodes, edges) {
    const ids = new Set(nodes.map(node => node.id));
    const parentOf = new Map();
    for (const edge of edges) {
        if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
        if (edge.kind === "category-membership" || edge.kind === "subcategory-membership") {
            parentOf.set(edge.target, edge.source);
        }
    }
    const cache = new Map();
    const depthOf = id => {
        if (cache.has(id)) return cache.get(id);
        const parent = parentOf.get(id);
        if (!parent || parent === id) {
            cache.set(id, 0);
            return 0;
        }
        const depth = Math.min(8, depthOf(parent) + 1);
        cache.set(id, depth);
        return depth;
    };
    return { parentOf, depthOf };
}

function ringRadius(count, maxWidth, maxHeight, depth) {
    if (count <= 1) return depth === 0 ? 0 : 240 * depth;
    const safeSize = Math.max(maxWidth, maxHeight) * Math.SQRT2;
    const angularRadius = safeSize / (2 * Math.sin(Math.PI / count));
    return Math.max(240 * (depth + 1), angularRadius + safeSize + 40);
}

export function layoutGraph(nodes, edges, iterations = layoutIterationsFor(nodes.length)) {
    nodes = nodes.slice(0, MAX_GRAPH_NODES);
    const nodeIds = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, MAX_GRAPH_EDGES);
    if (!nodes.length) return [];

    const { parentOf, depthOf } = nodeDepths(nodes, edges);
    const depths = new Map(nodes.map(node => [node.id, depthOf(node.id)]));
    const levels = new Map();
    for (const node of nodes) {
        const depth = depths.get(node.id);
        if (!levels.has(depth)) levels.set(depth, []);
        levels.get(depth).push(node);
    }

    const parentOrder = new Map();
    const orderedLevels = [...levels.keys()].sort((a, b) => a - b);
    const positions = new Map();
    let previousRadius = 0;
    let previousHeight = 0;
    for (const depth of orderedLevels) {
        const level = levels.get(depth).sort((left, right) => {
            const leftParent = parentOrder.get(parentOf.get(left.id)) || 0;
            const rightParent = parentOrder.get(parentOf.get(right.id)) || 0;
            return leftParent - rightParent || kindRank(left.kind) - kindRank(right.kind) || left.id.localeCompare(right.id);
        });
        const maxWidth = Math.max(50, ...level.map(node => Number(node.width) || 50));
        const maxHeight = Math.max(50, ...level.map(node => Number(node.height) || 50));
        const radius = Math.max(
            ringRadius(level.length, maxWidth, maxHeight, depth),
            depth === 0 ? 0 : previousRadius + previousHeight / 2 + maxHeight / 2 + 60
        );
        const start = depth === 0 ? -Math.PI / 2 : -Math.PI / 2 + (depth % 2 ? 0.15 : -0.15);
        level.forEach((node, index) => {
            const angle = level.length === 1 ? start : start + (Math.PI * 2 * index) / level.length;
            positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
            parentOrder.set(node.id, index);
        });
        previousRadius = radius;
        previousHeight = maxHeight;
    }
    return nodes.map(node => ({ id: node.id, ...positions.get(node.id) }));
}

if (typeof self !== "undefined") {
    self.addEventListener("message", event => {
        const { type, requestId } = event.data || {};
        if (type === "parse-metadata") {
            self.postMessage({ type: "metadata-result", requestId, entries: (event.data.files || []).map(parseMetadata) });
        }
        if (type === "layout") {
            const positions = layoutGraph(event.data.nodes || [], event.data.edges || [], event.data.iterations);
            self.postMessage({ type: "layout-result", requestId, positions });
        }
    });
}
