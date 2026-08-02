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

function hashSeed(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
}

function connectedComponents(nodes, edges) {
    const parent = new Map(nodes.map(node => [node.id, node.id]));
    const find = id => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root);
        while (parent.get(id) !== id) {
            const next = parent.get(id);
            parent.set(id, root);
            id = next;
        }
        return root;
    };
    const join = (left, right) => {
        const a = find(left);
        const b = find(right);
        if (a !== b) parent.set(b, a);
    };
    for (const edge of edges) if (parent.has(edge.source) && parent.has(edge.target)) join(edge.source, edge.target);
    const components = new Map();
    for (const node of nodes) {
        const root = find(node.id);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(node);
    }
    return [...components.values()].sort((left, right) => right.length - left.length || left[0].id.localeCompare(right[0].id));
}

function initialNetworkPositions(nodes, edges) {
    const positions = new Map();
    const components = connectedComponents(nodes, edges);
    let offset = 0;
    components.forEach((component, componentIndex) => {
        const componentRadius = Math.max(260, Math.sqrt(component.length) * 190);
        const centerAngle = componentIndex * 2.399963229728653;
        const centerX = Math.cos(centerAngle) * offset;
        const centerY = Math.sin(centerAngle) * offset;
        component.forEach((node, index) => {
            const angle = index * 2.399963229728653 + hashSeed(node.id) * 0.4;
            const radius = Math.sqrt(index + 1) * Math.max(120, componentRadius / Math.sqrt(component.length));
            positions.set(node.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, vx: 0, vy: 0 });
        });
        offset += componentRadius * 2 + 320;
    });
    return positions;
}

function separateOverlaps(nodes, positions, passes = 4) {
    const cellSize = 240;
    for (let pass = 0; pass < passes; pass += 1) {
        const buckets = new Map();
        for (const node of nodes) {
            const position = positions.get(node.id);
            const key = `${Math.floor(position.x / cellSize)},${Math.floor(position.y / cellSize)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(node);
        }
        for (const node of nodes) {
            const position = positions.get(node.id);
            const cellX = Math.floor(position.x / cellSize);
            const cellY = Math.floor(position.y / cellSize);
            for (let x = cellX - 1; x <= cellX + 1; x += 1) for (let y = cellY - 1; y <= cellY + 1; y += 1) {
                for (const other of buckets.get(`${x},${y}`) || []) {
                    if (node.id >= other.id) continue;
                    const target = positions.get(other.id);
                    const minX = ((Number(node.width) || 188) + (Number(other.width) || 188)) / 2 + 24;
                    const minY = ((Number(node.height) || 68) + (Number(other.height) || 68)) / 2 + 24;
                    const dx = position.x - target.x;
                    const dy = position.y - target.y;
                    if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
                    const pushX = minX - Math.abs(dx);
                    const pushY = minY - Math.abs(dy);
                    if (pushX < pushY) {
                        const direction = dx || (node.id < other.id ? 1 : -1);
                        const delta = (direction < 0 ? -pushX : pushX) / 2;
                        position.x += delta;
                        target.x -= delta;
                    } else {
                        const direction = dy || (node.id < other.id ? 1 : -1);
                        const delta = (direction < 0 ? -pushY : pushY) / 2;
                        position.y += delta;
                        target.y -= delta;
                    }
                }
            }
        }
    }
}

export function layoutGraph(nodes, edges, iterations = layoutIterationsFor(nodes.length)) {
    nodes = nodes.slice(0, MAX_GRAPH_NODES);
    const nodeIds = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, MAX_GRAPH_EDGES);
    if (!nodes.length) return [];

    const positions = initialNetworkPositions(nodes, edges);
    const edgePairs = edges.map(edge => ({
        source: positions.get(edge.source), target: positions.get(edge.target),
        distance: edge.kind === "category-membership" ? 220 : edge.kind === "subcategory-membership" ? 180 : 240
    })).filter(edge => edge.source && edge.target);
    const safeIterations = nodes.length > 5_000 ? Math.min(8, iterations) : Math.min(36, iterations);
    for (let iteration = 0; iteration < safeIterations; iteration += 1) {
        for (const pair of edgePairs) {
            const dx = pair.target.x - pair.source.x;
            const dy = pair.target.y - pair.source.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const force = (distance - pair.distance) * 0.018;
            pair.source.vx += dx / distance * force;
            pair.source.vy += dy / distance * force;
            pair.target.vx -= dx / distance * force;
            pair.target.vy -= dy / distance * force;
        }
        for (const position of positions.values()) {
            position.vx = (position.vx - position.x * 0.00035) * 0.82;
            position.vy = (position.vy - position.y * 0.00035) * 0.82;
            position.x += Math.max(-28, Math.min(28, position.vx));
            position.y += Math.max(-28, Math.min(28, position.vy));
        }
        separateOverlaps(nodes, positions, 1);
    }
    separateOverlaps(nodes, positions, nodes.length > 5_000 ? 1 : 5);
    return nodes.map(node => {
        const position = positions.get(node.id);
        return { id: node.id, x: position.x, y: position.y };
    });
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
