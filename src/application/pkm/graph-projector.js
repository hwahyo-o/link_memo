import { MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";
import { nodeGeometry } from "../../domain/pkm/graph-node-policy.js";
import { readLinkMemoGraphItems, isLinkMemoGraphIndexPath } from "./link-memo-vault-projector.js";

export { MAX_GRAPH_EDGES, MAX_GRAPH_NODES };

const keywordsLabel = item => (item.keywords || []).slice(0, 3).map(keyword => `#${keyword}`).join(" ");

function graphNode(node) {
    return { ...nodeGeometry(node.kind), ...node };
}

export function classifyLegacyGraphFiles(files) {
    const currentPaths = new Set(readLinkMemoGraphItems(files).map(item => item?.path).filter(Boolean));
    const candidates = files.filter(file => !file.deleted && !isLinkMemoGraphIndexPath(file.path) && !currentPaths.has(file.path));
    return {
        safeToDelete: candidates.filter(file => file.mutationId === "link-memo-import" && /^Link Memo\/.+\.md$/i.test(file.path)),
        preserveHidden: candidates.filter(file => !(file.mutationId === "link-memo-import" && /^Link Memo\/.+\.md$/i.test(file.path)))
    };
}

export function projectVaultGraph(files, metadataEntries) {
    const visibleFiles = files.filter(file => !file.deleted);
    const graphFiles = visibleFiles.filter(file => !isLinkMemoGraphIndexPath(file.path));
    const fileByPath = new Map(graphFiles.map(file => [file.path, file]));
    const indexedItems = readLinkMemoGraphItems(visibleFiles).filter(item => item?.path && item?.category?.id && item?.subcategory?.id && fileByPath.has(item.path));
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
            pushNode(graphNode({ id: category.id, title: category.label, keywordsLabel: `#${category.tag}`, label: category.label, openPath: null, kind: "category", color: category.color }));
        }
        if (!nodeIds.has(subcategory.id)) {
            if (!pushNode(graphNode({ id: subcategory.id, title: subcategory.label, keywordsLabel: `#${subcategory.tag}`, label: subcategory.label, openPath: null, kind: "subcategory", color: subcategory.color, categoryId: category.id }))) break;
        }
        if (!pushNode(graphNode({
            id: item.path,
            title: item.title,
            keywordsLabel: keywordsLabel(item),
            label: item.title,
            openPath: /\.md$/i.test(item.path) ? item.path : null,
            kind: "item",
            contentKind: item.contentKind,
            color: item.color,
            summary: item.summary,
            keywords: item.keywords,
            keywordKeys: item.keywordKeys,
            categoryId: category.id,
            subcategoryId: subcategory.id,
            facets: item.facets
        }))) break;
        includedItems.push(item);
    }

    for (const item of includedItems) {
        pushRawEdge(item.category.id, item.subcategory.id, "소속", "category-membership");
        pushRawEdge(item.subcategory.id, item.path, "포함", "subcategory-membership");
    }

    for (const metadata of metadataEntries) {
        for (const target of metadata.resolvedLinks || []) pushRawEdge(metadata.path, target, "링크", "wiki-link");
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
        (item.keywordKeys || []).forEach((keyword, index) => {
            if (!keyword) return;
            if (!keywordGroups.has(keyword)) keywordGroups.set(keyword, { ids: [], label: item.keywords[index] || keyword });
            keywordGroups.get(keyword).ids.push(item.path);
        });
    }
    for (const group of typeGroups.values()) connectGroup(group.ids, group.kind, group.label);
    for (const group of keywordGroups.values()) connectGroup(group.ids, "keyword-related", group.label);

    return { nodes, edges };
}
