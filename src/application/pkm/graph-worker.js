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
        path: file.path,
        title,
        content,
        tags,
        comments,
        links: [...links, ...urls],
        resolvedLinks: links.map(link => resolveWikiLink(file.path, link)).filter(Boolean)
    };
}

export function layoutGraph(nodes, edges, iterations = layoutIterationsFor(nodes.length)) {
    nodes = nodes.slice(0, MAX_GRAPH_NODES);
    const nodeIds = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, MAX_GRAPH_EDGES);
    const count = nodes.length;
    const side = Math.max(1, Math.ceil(Math.sqrt(count)));
    const positions = new Map(nodes.map((node, index) => [node.id, {
        x: (index % side) * 110 + (index % 7) * 9,
        y: Math.floor(index / side) * 86 + (index % 11) * 7,
        vx: 0,
        vy: 0
    }]));
    const edgePairs = edges.map(edge => {
        const profiles = {
            "category-membership": { distance: 170, strength: 0.0045 },
            "subcategory-membership": { distance: 105, strength: 0.0052 },
            "same-link-type": { distance: 145, strength: 0.0025 },
            "same-image-type": { distance: 145, strength: 0.0025 },
            "keyword-related": { distance: 210, strength: 0.0016 }
        };
        return {
            source: positions.get(edge.source),
            target: positions.get(edge.target),
            ...(profiles[edge.kind] || { distance: 130, strength: 0.0028 })
        };
    }).filter(pair => pair.source && pair.target);
    const cellSize = 160;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const buckets = new Map();
        for (const [id, position] of positions) {
            const key = `${Math.floor(position.x / cellSize)},${Math.floor(position.y / cellSize)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push([id, position]);
        }
        for (const [id, position] of positions) {
            const cellX = Math.floor(position.x / cellSize);
            const cellY = Math.floor(position.y / cellSize);
            for (let x = cellX - 1; x <= cellX + 1; x += 1) {
                for (let y = cellY - 1; y <= cellY + 1; y += 1) {
                    for (const [otherId, other] of buckets.get(`${x},${y}`) || []) {
                        if (id === otherId) continue;
                        const dx = position.x - other.x || 0.1;
                        const dy = position.y - other.y || 0.1;
                        const distanceSquared = Math.max(64, dx * dx + dy * dy);
                        const force = 720 / distanceSquared;
                        position.vx += dx * force;
                        position.vy += dy * force;
                    }
                }
            }
        }
        for (const { source, target, distance: desiredDistance, strength } of edgePairs) {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const force = (distance - desiredDistance) * strength;
            source.vx += dx * force;
            source.vy += dy * force;
            target.vx -= dx * force;
            target.vy -= dy * force;
        }
        for (const position of positions.values()) {
            position.vx = (position.vx - position.x * 0.0003) * 0.72;
            position.vy = (position.vy - position.y * 0.0003) * 0.72;
            position.x += Math.max(-18, Math.min(18, position.vx));
            position.y += Math.max(-18, Math.min(18, position.vy));
        }
    }
    return nodes.map(node => ({ id: node.id, x: positions.get(node.id).x, y: positions.get(node.id).y }));
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
