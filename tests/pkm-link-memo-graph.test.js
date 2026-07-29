import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_GRAPH_EDGES, MAX_GRAPH_NODES, layoutIterationsFor } from "../src/domain/pkm/graph-limits.js";
import { projectVaultGraph } from "../src/application/pkm/graph-projector.js";
import {
    projectMainMemoToVaultFiles,
    readLinkMemoGraphItems,
    reconcileLinkMemoProjection
} from "../src/application/pkm/link-memo-vault-projector.js";

const payload = {
    updatedAt: 100,
    linkData: {
        공부: [{
            id: "ai",
            title: "인공지능",
            links: [
                { id: "text", text: "AI 개념", comment: "인공지능 머신러닝 모델 학습을 정리합니다.", updatedAt: 91 },
                { id: "link", text: "OpenAI 문서", url: "https://example.com/ai/model", updatedAt: 92 },
                { id: "image", text: "모델 구조", images: [{ imageId: "image-1", name: "인공지능 모델 구조" }], updatedAt: 93 },
                {
                    id: "all",
                    text: "멀티모달 자료",
                    url: "https://example.com/multimodal",
                    comment: "텍스트와 이미지를 함께 처리하는 인공지능 자료입니다.",
                    images: [{ imageId: "image-2", name: "멀티모달" }],
                    updatedAt: 94
                }
            ]
        }]
    }
};

const metadataFor = files => files.filter(file => file.type === "md").map(file => ({ path: file.path, resolvedLinks: [] }));

describe("Link Memo hierarchical PKM graph", () => {
    it("raises the graph caps tenfold and reduces large-layout work", () => {
        expect(MAX_GRAPH_NODES).toBe(100_000);
        expect(MAX_GRAPH_EDGES).toBe(500_000);
        expect(layoutIterationsFor(100_000)).toBe(2);
        expect(layoutIterationsFor(25_000)).toBe(4);
    });

    it("creates one Markdown file per button with sharded graph metadata", () => {
        const files = projectMainMemoToVaultFiles(payload);
        const markdown = files.filter(file => file.type === "md");
        const items = readLinkMemoGraphItems(files);
        expect(markdown).toHaveLength(4);
        expect(items).toHaveLength(4);
        expect(files.some(file => file.path === "Link Memo/.graph-index.json")).toBe(true);
        expect(files.some(file => file.path.startsWith("Link Memo/.graph-index/") && file.type === "json")).toBe(true);
        items.forEach(item => expect(item.keywords.length).toBeGreaterThanOrEqual(3));
        expect(items.find(item => item.sourceId === "all")).toMatchObject({
            contentKind: "link-image-text",
            color: "#DE6863",
            facets: { link: true, image: true, text: true }
        });
    });

    it("keeps hierarchy in the label while exposing summaries only as node data", () => {
        const files = projectMainMemoToVaultFiles(payload);
        const graph = projectVaultGraph(files, metadataFor(files));
        const item = graph.nodes.find(node => node.kind === "item" && node.summary?.includes("머신러닝"));
        expect(item.label).toContain("AI 개념");
        expect(item.label).toContain("#");
        expect(item.label).not.toContain(item.summary);
        expect(graph.nodes.some(node => node.kind === "category" && node.color === "#F6E7FF")).toBe(true);
        expect(graph.nodes.some(node => node.kind === "subcategory" && node.color === "#B9BFFF")).toBe(true);
        expect(graph.edges.some(edge => edge.kind === "category-membership")).toBe(true);
        expect(graph.edges.some(edge => edge.kind === "subcategory-membership" && edge.target === item.id)).toBe(true);
        expect(graph.edges.some(edge => edge.kind === "keyword-related")).toBe(true);
    });

    it("preserves user-edited generated Markdown and removes only unchanged stale files", () => {
        const previous = projectMainMemoToVaultFiles(payload);
        const previousItems = readLinkMemoGraphItems(previous);
        const editedPath = previousItems.find(item => item.sourceId === "text").path;
        const stalePath = previousItems.find(item => item.sourceId === "image").path;
        const current = previous.map(file => file.path === editedPath ? { ...file, content: `${file.content}\n사용자 편집` } : file);
        const nextPayload = structuredClone(payload);
        nextPayload.linkData.공부[0].links = nextPayload.linkData.공부[0].links.filter(item => !["text", "image"].includes(item.id));
        const reconciled = reconcileLinkMemoProjection({ files: current }, projectMainMemoToVaultFiles(nextPayload), 200);
        expect(reconciled.files.some(file => file.path === editedPath && file.deleted)).toBe(false);
        expect(reconciled.files.some(file => file.path === stalePath && file.deleted)).toBe(true);
    });

    it("supports desktop hover and one-tap non-PC summary tooltips without Playwright", () => {
        const html = readFileSync(new URL("../pkm.html", import.meta.url), "utf8");
        const css = readFileSync(new URL("../styles/pkm.css", import.meta.url), "utf8");
        const graphView = readFileSync(new URL("../src/presentation/pkm/graph-view.js", import.meta.url), "utf8");
        expect(html).toContain('id="graphTooltip"');
        expect(html).toContain("#DE6863");
        expect(css).toContain(".graph-tooltip");
        expect(graphView).toContain('cy.on("mouseover", \'node[kind = "item"]\'');
        expect(graphView).toContain("if (nonPcMode && !doubleTap) showTooltip(node)");
        expect(graphView).toContain('tooltip.textContent = summary');
    });
});
