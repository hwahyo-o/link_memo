import { describe, expect, it } from "vitest";
import { MAX_CANVAS_NODES, parseJsonCanvas } from "./json-canvas-parser.js";

describe("JSON Canvas parser", () => {
    it("parses all node types and edge arrow defaults", () => {
        const canvas = parseJsonCanvas({
            nodes: [
                { id: "t", type: "text", x: 0, y: 0, width: 100, height: 80, text: "# Text" },
                { id: "f", type: "file", x: 120, y: 0, width: 100, height: 80, file: "note.md", subpath: "#heading" },
                { id: "l", type: "link", x: 240, y: 0, width: 100, height: 80, url: "https://example.com" },
                { id: "g", type: "group", x: 0, y: 120, width: 360, height: 200, label: "Group" }
            ],
            edges: [{ id: "e", fromNode: "t", toNode: "f", label: "ref" }]
        });
        expect(canvas.nodes.map(node => node.type)).toEqual(["text", "file", "link", "group"]);
        expect(canvas.edges[0]).toMatchObject({ fromEnd: "none", toEnd: "arrow", label: "ref" });
    });

    it("rejects edges that reference missing nodes", () => {
        expect(() => parseJsonCanvas({
            nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" }],
            edges: [{ id: "e", fromNode: "a", toNode: "missing" }]
        })).toThrow("CANVAS_EDGE_NODE_MISSING");
    });

    it("rejects canvases beyond the shared graph node budget", () => {
        expect(() => parseJsonCanvas({
            nodes: Array.from({ length: MAX_CANVAS_NODES + 1 }),
            edges: []
        })).toThrow("CANVAS_NODE_LIMIT_EXCEEDED");
    });
});
