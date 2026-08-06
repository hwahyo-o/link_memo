import { layoutIterationsFor, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";
import {
    GRAPH_LAYOUT_RULES,
    aabbSeparated,
    categorySeparationSatisfied,
    categoryOwnershipSatisfied,
    centerDistance,
    deriveCategoryGroupRadius,
    hierarchyBandSatisfied,
    nearestParentSatisfied,
    parentDistanceLimit,
    parentEdgeAngleSeparated,
    siblingEdgeAngleLimit
} from "../../domain/pkm/graph-layout-policy.js";

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

function createHierarchy(nodes, edges) {
    const nodeIds = new Set(nodes.map(node => node.id));
    const parents = new Map();
    const children = new Map(nodes.map(node => [node.id, []]));
    const addRelation = (parentId, childId) => {
        if (!nodeIds.has(parentId) || !nodeIds.has(childId) || parents.has(childId)) return;
        parents.set(childId, parentId);
        children.get(parentId).push(childId);
    };
    nodes.forEach(node => {
        if (node.kind === "subcategory") addRelation(node.categoryId, node.id);
        if (node.kind === "item") addRelation(node.subcategoryId, node.id);
    });
    edges.forEach(edge => {
        if (edge.kind === "category-membership" || edge.kind === "subcategory-membership") addRelation(edge.source, edge.target);
    });
    return { parents, children };
}

function packWithoutOverlap(nodes, positions, edges) {
    const nodeGap = GRAPH_LAYOUT_RULES.preferredNodeGap;
    const cellSize = 400;
    const buckets = new Map();
    const placed = new Set();
    const hierarchy = createHierarchy(nodes, edges);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const childrenByParent = new Map(nodes.map(node => [
        node.id,
        (hierarchy.children.get(node.id) || [])
            .map(childId => byId.get(childId))
            .filter(Boolean)
    ]));
    const roots = nodes.filter(node => !hierarchy.parents.has(node.id) && (node.kind === "category" || hierarchy.children.get(node.id)?.length));
    const categories = roots.filter(node => node.kind === "category");
    const otherRoots = roots.filter(node => node.kind !== "category");
    const hierarchyNodes = nodes.filter(node => hierarchy.parents.has(node.id));
    const orphans = nodes.filter(node => !hierarchy.parents.has(node.id) && !hierarchy.children.get(node.id)?.length);

    const bucketKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    const collides = (node, x, y) => {
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        for (let bucketX = cellX - 1; bucketX <= cellX + 1; bucketX += 1) {
            for (let bucketY = cellY - 1; bucketY <= cellY + 1; bucketY += 1) {
                for (const other of buckets.get(`${bucketX},${bucketY}`) || []) {
                    if (!aabbSeparated(node, other, { x, y }, positions.get(other.id), nodeGap)) return true;
                }
            }
        }
        return false;
    };
    const mark = (node, position) => {
        positions.set(node.id, { ...positions.get(node.id), x: position.x, y: position.y });
        placed.add(node.id);
        const key = bucketKey(position.x, position.y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(node);
    };
    const findFreePosition = (
        node,
        origin,
        parent = null,
        radius = 0,
        accept = () => true,
        angleCenter = null,
        angleWindow = Math.PI
    ) => {
        const parentPosition = parent ? positions.get(parent.id) : null;
        const withinParent = candidate => !parent || centerDistance(candidate, parentPosition) <= radius;
        const valid = candidate => withinParent(candidate)
            && !collides(node, candidate.x, candidate.y)
            && (!parent || aabbSeparated(node, parent, candidate, parentPosition, nodeGap))
            && accept(candidate);
        if (valid(origin)) return origin;

        const goldenAngle = 2.399963229728653;
        const minimumRadius = parent ? Math.max(120, Math.max(node.width || 188, parent.width || 188) + nodeGap) : 0;
        const ringStep = 180;
        const maxRing = parent ? Math.max(1, Math.ceil(Math.max(0, radius - minimumRadius) / ringStep)) : 200;
        for (let ring = parent ? 0 : 1; ring <= maxRing; ring += 1) {
            const candidateRadius = parent ? Math.min(radius, minimumRadius + ring * ringStep) : ring * ringStep;
            const count = Math.max(8, ring * 8);
            for (let index = 0; index < count; index += 1) {
                const angle = angleCenter === null
                    ? goldenAngle * (ring * count + index) + hashSeed(node.id) * 0.5
                    : angleCenter
                        + (((index + 0.5) / count) - 0.5) * angleWindow
                        + (hashSeed(node.id) - 0.5) * angleWindow * 0.3;
                const candidate = parent
                    ? { x: parentPosition.x + Math.cos(angle) * candidateRadius, y: parentPosition.y + Math.sin(angle) * candidateRadius }
                    : { x: origin.x + Math.cos(angle) * candidateRadius, y: origin.y + Math.sin(angle) * candidateRadius };
                if (valid(candidate)) return candidate;
            }
        }
        return null;
    };

    const getCategoryGroupRadius = (category, scale) => deriveCategoryGroupRadius(
        category,
        (childrenByParent.get(category.id) || []).filter(node => node.kind === "subcategory"),
        childrenByParent,
        nodeGap * scale
    );

    const categoryAncestor = nodeId => {
        let current = nodeId;
        while (hierarchy.parents.has(current)) current = hierarchy.parents.get(current);
        return byId.get(current)?.kind === "category" ? current : null;
    };

    const placeCategories = scale => {
        for (const node of categories.slice().sort((left, right) => left.id.localeCompare(right.id))) {
            const accept = candidate => categories.every(other => other.id === node.id || !placed.has(other.id)
                || categorySeparationSatisfied(
                    node,
                    other,
                    candidate,
                    positions.get(other.id),
                    getCategoryGroupRadius(node, scale),
                    getCategoryGroupRadius(other, scale)
                ));
            const position = findFreePosition(node, positions.get(node.id), null, 0, accept);
            if (!position) return false;
            mark(node, position);
        }
        return true;
    };

    const placeRoots = () => otherRoots.every(node => {
        const position = findFreePosition(node, positions.get(node.id));
        if (!position) return false;
        mark(node, position);
        return true;
    });

    const placeChildren = scale => {
        const ordered = hierarchyNodes.slice().sort((left, right) => {
            const rank = node => node.kind === "subcategory" ? 0 : 1;
            const leftParent = hierarchy.parents.get(left.id);
            const rightParent = hierarchy.parents.get(right.id);
            return rank(left) - rank(right) || String(leftParent).localeCompare(String(rightParent)) || left.id.localeCompare(right.id);
        });
        for (const node of ordered) {
            const parent = byId.get(hierarchy.parents.get(node.id));
            const parentPosition = positions.get(parent?.id);
            if (!parent || !parentPosition || !placed.has(parent.id)) return false;
            const siblings = (childrenByParent.get(parent.id) || [])
                .filter(sibling => sibling.kind === node.kind)
                .sort((left, right) => left.id.localeCompare(right.id));
            const siblingIndex = siblings.findIndex(sibling => sibling.id === node.id);
            const siblingCount = Math.max(1, siblings.length);
            const slotWidth = Math.PI * 2 / siblingCount;
            const baseSlotAngle = (siblingIndex + 0.5) * slotWidth
                + hashSeed(parent.id) * slotWidth * 0.3;
            const categoryId = categoryAncestor(node.id);
            const category = categoryId ? byId.get(categoryId) : null;
            const categoryPosition = category ? positions.get(category.id) : null;
            const categoryRadius = category
                ? getCategoryGroupRadius(category, scale)
                : null;
            const otherRegions = categories
                .filter(other => other.id !== categoryId && positions.get(other.id))
                .map(other => ({
                    position: positions.get(other.id),
                    radius: getCategoryGroupRadius(other, scale)
                }));
            const outwardAngle = categoryPosition
                ? Math.atan2(parentPosition.y - categoryPosition.y, parentPosition.x - categoryPosition.x)
                : baseSlotAngle;
            const itemFanWidth = Math.min(Math.PI * 1.1, Math.PI * 2);
            const slotAngle = node.kind === "item" && categoryPosition
                ? outwardAngle + (((siblingIndex + 0.5) / siblingCount) - 0.5) * itemFanWidth
                : baseSlotAngle;
            const peerPositions = siblings
                .slice(0, Math.max(0, siblingIndex))
                .map(sibling => positions.get(sibling.id))
                .filter(Boolean);
            const accept = candidate => {
                const regionSatisfied = !category
                    || categoryOwnershipSatisfied(
                        candidate,
                        node,
                        categoryPosition,
                        categoryRadius,
                        otherRegions,
                        nodeGap
                    );
                const hierarchySatisfied = !category
                    || hierarchyBandSatisfied(
                        node,
                        candidate,
                        parentPosition,
                        categoryPosition,
                        node.kind,
                        nodeGap
                    );
                return regionSatisfied
                    && hierarchySatisfied
                    && nearestParentSatisfied(candidate, parentPosition, peerPositions)
                    && parentEdgeAngleSeparated(
                        candidate,
                        parentPosition,
                        peerPositions,
                        siblingEdgeAngleLimit(siblingCount)
                    );
            };
            const position = findFreePosition(
                node,
                positions.get(node.id),
                parent,
                parentDistanceLimit(parent, node, node.kind, nodeGap * scale),
                accept,
                slotAngle,
                node.kind === "item"
                    ? Math.min(Math.PI / 3, Math.max(0.24, itemFanWidth / siblingCount * 0.75))
                    : Math.min(Math.PI / 2, slotWidth * 0.7)
            );
            if (!position) return false;
            mark(node, position);
        }
        return true;
    };

    for (const scale of [1, 1.5, 2, 3, 4, 6, 8]) {
        buckets.clear();
        placed.clear();
        if (!placeCategories(scale) || !placeRoots() || !placeChildren(scale)) continue;
        const orderedOrphans = orphans.slice().sort((left, right) => hashSeed(left.id) - hashSeed(right.id) || left.id.localeCompare(right.id));
        if (!orderedOrphans.every(node => {
            const position = findFreePosition(node, positions.get(node.id));
            if (!position) return false;
            mark(node, position);
            return true;
        })) continue;
        if (nodes.every(node => Number.isFinite(positions.get(node.id)?.x) && Number.isFinite(positions.get(node.id)?.y))) return;
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
    packWithoutOverlap(nodes, positions, edges);
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
