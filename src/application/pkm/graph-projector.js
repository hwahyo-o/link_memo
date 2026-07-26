import { parseJsonCanvas } from "../../domain/pkm/json-canvas-parser.js";

function titleFor(path) {
    return path.split("/").pop().replace(/\.(md|json|canvas)$/i, "");
}

export function projectVaultGraph(files, metadataEntries) {
    const visibleFiles = files.filter(file => !file.deleted);
    const filePaths = new Set(visibleFiles.map(file => file.path));
    const nodes = visibleFiles.map(file => ({
        id: file.path,
        label: titleFor(file.path),
        path: file.path,
        kind: file.type
    }));
    const edges = [];
    const edgeIds = new Set();
    const nodeIds = new Set(nodes.map(node => node.id));
    const pushRawEdge = (source, target, label = "") => {
        const id = `${source}->${target}:${label}`;
        if (!nodeIds.has(source) || !nodeIds.has(target) || edgeIds.has(id)) return;
        edgeIds.add(id);
        edges.push({ id, source, target, label });
    };
    const pushEdge = (source, target, label = "") => {
        if (filePaths.has(source) && filePaths.has(target)) pushRawEdge(source, target, label);
    };

    for (const metadata of metadataEntries) {
        for (const target of metadata.resolvedLinks || []) pushEdge(metadata.path, target, "링크");
    }

    for (const file of visibleFiles.filter(item => item.type === "canvas")) {
        try {
            const canvas = parseJsonCanvas(file.content);
            for (const node of canvas.nodes) {
                const id = `${file.path}::${node.id}`;
                const label = node.type === "text"
                    ? node.text.replace(/^#+\s*/, "").slice(0, 50) || "텍스트"
                    : node.type === "file"
                        ? titleFor(node.file)
                        : node.type === "link"
                            ? node.url.replace(/^https?:\/\//, "").slice(0, 50)
                            : node.label || "그룹";
                nodes.push({
                    id,
                    label,
                    path: node.type === "file" && filePaths.has(node.file) ? node.file : file.path,
                    kind: `canvas-${node.type}`
                });
                nodeIds.add(id);
                if (node.type === "file" && filePaths.has(node.file)) pushEdge(file.path, node.file, "캔버스");
            }
            for (const edge of canvas.edges) {
                pushRawEdge(
                    `${file.path}::${edge.fromNode}`,
                    `${file.path}::${edge.toNode}`,
                    edge.label || ""
                );
            }
        } catch {
            // A malformed canvas is isolated to its file; the rest of the vault remains usable.
        }
    }
    return { nodes, edges };
}
