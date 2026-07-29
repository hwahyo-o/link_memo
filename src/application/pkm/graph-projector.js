import { parseJsonCanvas } from "../../domain/pkm/json-canvas-parser.js";
import { MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";
import { readLinkMemoGraphItems, GRAPH_INDEX_MANIFEST_PATH, GRAPH_INDEX_SHARD_PREFIX } from "./link-memo-vault-projector.js";

export { MAX_GRAPH_EDGES, MAX_GRAPH_NODES };

function titleFor(path) {
    return path.split("/").pop().replace(/\.(md|json|canvas)$/i, "");
}

const isGraphIndex = path => path === GRAPH_INDEX_MANIFEST_PATH || path.startsWith(GRAPH_INDEX_SHARD_PREFIX);
const buttonLabel = item => [item.title, item.keywords.slice(0, 3).map(keyword => `#${keyword}`).join(" ")].filter(Boolean).join("\n");

export function projectVaultGraph(files, metadataEntries) {
    const visibleFiles = files.filter(file => !file.deleted);
    const graphFiles = visibleFiles.filter(file => !isGraphIndex(file.path));
    const fileByPath = new Map(graphFiles.map(file => [file.path, file]));
    const indexedItems = readLinkMemoGraphItems(visibleFiles).filter(item => fileByPath.has(item.path));
    const itemByPath = new Map(indexedItems.map(item => [item.path, item]));
    const nodes = [];
    const edges = [];
    const nodeIds = new Set();
    const edgeIds = new Set();
    const includedItems = [];

    const pushNode = node => {
        if (nodes.length >= MAX_GRAPH_NODES || nodeIds.has(node.id)) return false;
        nodeIds.add(node.id);
        nodes.push(node);
        return true;
    };
    const pushRawEdge = (source, target, label = "", kind = "link") => {
        if (edges.length >= MAX_GRAPH_EDGES || !nodeIds.has(source) || !nodeIds.has(target) || source === target) return false;
        const ordered = kind.startsWith("keyword") || kind.startsWith("same-")
            ? [source, target].sort()
            : [source, target];
        const id = `${ordered[0]}->${ordered[1]}:${kind}:${label}`;
        if (edgeIds.has(id)) return false;
        edgeIds.add(id);
        edges.push({ id, source: ordered[0], target: ordered[1], label, kind });
        return true;
    };

    for (const item of indexedItems) {
        const category = item.category;
        const subcategory = item.subcategory;
        if (!nodeIds.has(category.id)) {
            pushNode({ id: category.id, label: `${category.label}\n#${category.tag}`, path: null, kind: "category", color: category.color });
        }
        if (!nodeIds.has(subcategory.id)) {
            if (!pushNode({ id: subcategory.id, label: `${subcategory.label}\n#${subcategory.tag}`, path: null, kind: "subcategory", color: subcategory.color, categoryId: category.id })) break;
        }
        if (!pushNode({
            id: item.path,
            label: buttonLabel(item),
            path: item.path,
            kind: "item",
            contentKind: item.contentKind,
            color: item.color,
            summary: item.summary,
            keywords: item.keywords,
            keywordKeys: item.keywordKeys,
            categoryId: category.id,
            subcategoryId: subcategory.id,
            facets: item.facets
        })) break;
        includedItems.push(item);
    }

    for (const file of graphFiles) {
        if (itemByPath.has(file.path) || nodes.length >= MAX_GRAPH_NODES) continue;
        pushNode({ id: file.path, label: titleFor(file.path), path: file.path, kind: file.type, color: "#e2e8f0" });
    }

    for (const item of includedItems) {
        pushRawEdge(item.category.id, item.subcategory.id, "소속", "category-membership");
        pushRawEdge(item.subcategory.id, item.path, "포함", "subcategory-membership");
    }

    for (const metadata of metadataEntries) {
        for (const target of metadata.resolvedLinks || []) pushRawEdge(metadata.path, target, "링크", "wiki-link");
    }

    for (const file of graphFiles.filter(item => item.type === "canvas" && nodeIds.has(item.path))) {
        if (nodes.length >= MAX_GRAPH_NODES) break;
        try {
            const canvas = parseJsonCanvas(file.content);
            for (const node of canvas.nodes) {
                if (nodes.length >= MAX_GRAPH_NODES) break;
                const id = `${file.path}::${node.id}`;
                const label = node.type === "text"
                    ? node.text.replace(/^#+\s*/, "").slice(0, 50) || "텍스트"
                    : node.type === "file"
                        ? titleFor(node.file)
                        : node.type === "link"
                            ? node.url.replace(/^https?:\/\//, "").slice(0, 50)
                            : node.label || "그룹";
                pushNode({
                    id,
                    label,
                    path: node.type === "file" && nodeIds.has(node.file) ? node.file : file.path,
                    kind: `canvas-${node.type}`,
                    color: "#e2e8f0"
                });
                if (node.type === "file") pushRawEdge(file.path, node.file, "캔버스", "canvas-file");
            }
            for (const edge of canvas.edges) {
                if (edges.length >= MAX_GRAPH_EDGES) break;
                pushRawEdge(`${file.path}::${edge.fromNode}`, `${file.path}::${edge.toNode}`, edge.label || "", "canvas-link");
            }
        } catch {
            // A malformed canvas is isolated to its file; the rest of the vault remains usable.
        }
    }

    const connectGroup = (ids, kind, label) => {
        const unique = [...new Set(ids)].filter(id => nodeIds.has(id)).sort();
        if (unique.length <= 32) {
            for (let left = 0; left < unique.length; left += 1) {
                for (let right = left + 1; right < unique.length; right += 1) {
                    if (!pushRawEdge(unique[left], unique[right], label, kind) && edges.length >= MAX_GRAPH_EDGES) return;
                }
            }
            return;
        }
        unique.forEach((id, index) => {
            pushRawEdge(id, unique[(index + 1) % unique.length], label, kind);
            pushRawEdge(id, unique[(index + 2) % unique.length], label, kind);
        });
    };

    const typeGroups = new Map();
    const keywordGroups = new Map();
    for (const item of includedItems) {
        if (item.facets?.link) {
            const key = `${item.subcategory.id}:link`;
            if (!typeGroups.has(key)) typeGroups.set(key, { ids: [], kind: "same-link-type", label: "링크 유형" });
            typeGroups.get(key).ids.push(item.path);
        }
        if (item.facets?.image) {
            const key = `${item.subcategory.id}:image`;
            if (!typeGroups.has(key)) typeGroups.set(key, { ids: [], kind: "same-image-type", label: "이미지 유형" });
            typeGroups.get(key).ids.push(item.path);
        }
        item.keywordKeys.forEach((keyword, index) => {
            if (!keyword) return;
            if (!keywordGroups.has(keyword)) keywordGroups.set(keyword, { ids: [], label: item.keywords[index] || keyword });
            keywordGroups.get(keyword).ids.push(item.path);
        });
    }
    for (const group of typeGroups.values()) connectGroup(group.ids, group.kind, group.label);
    for (const group of keywordGroups.values()) connectGroup(group.ids, "keyword-related", group.label);

    return { nodes, edges };
}
