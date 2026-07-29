import { describe, expect, it } from "vitest";
import { projectVaultGraph } from "./graph-projector.js";

describe("PKM graph projector", () => {
    it("projects JSON Canvas text, file, link and group nodes with directed edges", () => {
        const files = [
            { path: "note.md", type: "md", content: "# Note" },
            {
                path: "map.canvas",
                type: "canvas",
                content: JSON.stringify({
                    nodes: [
                        { id: "text", type: "text", x: 0, y: 0, width: 100, height: 80, text: "Idea" },
                        { id: "file", type: "file", x: 120, y: 0, width: 100, height: 80, file: "note.md" },
                        { id: "link", type: "link", x: 240, y: 0, width: 100, height: 80, url: "https://example.com" },
                        { id: "group", type: "group", x: 0, y: 100, width: 360, height: 200, label: "Group" }
                    ],
                    edges: [{ id: "edge", fromNode: "text", toNode: "file", label: "ref" }]
                })
            }
        ];
        const graph = projectVaultGraph(files, []);
        expect(graph.nodes.filter(node => node.kind.startsWith("canvas-"))).toHaveLength(4);
        expect(graph.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: "map.canvas::text", target: "map.canvas::file", label: "ref" })
        ]));
    });

    it("caps the aggregate graph across multiple valid canvas files", () => {
        const makeCanvas = (path, count) => ({
            path,
            type: "canvas",
            content: JSON.stringify({
                nodes: Array.from({ length: count }, (_, index) => ({
                    id: `${path}-${index}`,
                    type: "text",
                    x: index,
                    y: 0,
                    width: 10,
                    height: 10,
                    text: "n"
                })),
                edges: []
            })
        });
        const graph = projectVaultGraph([
            makeCanvas("a.canvas", 60_000),
            makeCanvas("b.canvas", 60_000)
        ], []);
        expect(graph.nodes).toHaveLength(100_000);
    });
});
