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

function packWithoutOverlap(nodes, positions) {
    const nodeGap = 96;
    const cellSize = 400;
    const buckets = new Map();
    const bucketKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    const collides = (node, x, y) => {
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        for (let bucketX = cellX - 1; bucketX <= cellX + 1; bucketX += 1) for (let bucketY = cellY - 1; bucketY <= cellY + 1; bucketY += 1) {
            for (const other of buckets.get(`${bucketX},${bucketY}`) || []) {
                const target = positions.get(other.id);
                const minX = ((Number(node.width) || 188) + (Number(other.width) || 188)) / 2 + nodeGap;
                const minY = ((Number(node.height) || 68) + (Number(other.height) || 68)) / 2 + nodeGap;
                if (Math.abs(x - target.x) < minX && Math.abs(y - target.y) < minY) return true;
            }
        }
        return false;
    };
    const findFreePosition = (node, origin) => {
        if (!collides(node, origin.x, origin.y)) return origin;
        const goldenAngle = 2.399963229728653;
        for (let ring = 1; ring <= 200; ring += 1) {
            const radius = ring * 180;
            const count = Math.max(8, ring * 8);
            for (let index = 0; index < count; index += 1) {
                const angle = goldenAngle * (ring * count + index) + hashSeed(node.id) * 0.5;
                const candidate = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
                if (!collides(node, candidate.x, candidate.y)) return candidate;
            }
        }
        return { x: origin.x + 200 * Math.cos(hashSeed(node.id) * Math.PI * 2), y: origin.y + 200 * Math.sin(hashSeed(node.id) * Math.PI * 2) };
    };
    const ordered = nodes.slice().sort((left, right) => {
        const a = positions.get(left.id);
        const b = positions.get(right.id);
        return hashSeed(left.id) - hashSeed(right.id) || left.id.localeCompare(right.id);
    });
    for (const node of ordered) {
        const position = findFreePosition(node, positions.get(node.id));
        positions.set(node.id, { ...positions.get(node.id), x: position.x, y: position.y });
        const key = bucketKey(position.x, position.y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(node);
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
    }
    packWithoutOverlap(nodes, positions);
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
