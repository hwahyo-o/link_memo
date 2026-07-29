import { layoutIterationsFor, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";

const STYLE = [
    {
        selector: "node",
        style: {
            width: 50,
            height: 50,
            label: "data(label)",
            shape: "ellipse",
            "font-family": "Inter, Pretendard, Noto Sans KR, sans-serif",
            "font-size": 9,
            "font-weight": 650,
            color: "#334155",
            "text-wrap": "wrap",
            "text-max-width": 130,
            "text-valign": "center",
            "text-halign": "center",
            "background-color": "data(color)",
            "border-width": 1,
            "border-color": "#94a3b8",
            opacity: 0.94
        }
    },
    {
        selector: 'node[kind = "category"]',
        style: { width: 190, height: 86, shape: "round-rectangle", "text-max-width": 166, "font-size": 13, "font-weight": 700 }
    },
    {
        selector: 'node[kind = "subcategory"]',
        style: { width: 165, height: 74, shape: "round-rectangle", "text-max-width": 145, "font-size": 12, "font-weight": 700 }
    },
    {
        selector: 'node[kind = "item"]',
        style: { width: 158, height: 82, shape: "round-rectangle", "text-max-width": 140, "font-size": 10, "font-weight": 650 }
    },
    {
        selector: "edge",
        style: {
            width: 1,
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
            "target-arrow-shape": "none",
            "curve-style": "straight",
            opacity: 0.42
        }
    },
    {
        selector: 'edge[kind = "category-membership"], edge[kind = "subcategory-membership"]',
        style: { width: 2, "line-color": "#64748b", opacity: 0.7 }
    },
    {
        selector: 'edge[kind = "keyword-related"]',
        style: { "line-style": "dashed", "line-color": "#38bdf8", opacity: 0.38 }
    },
    {
        selector: "node.is-direct-match",
        style: {
            "font-weight": 800,
            "border-width": 4,
            "border-color": "#2563eb",
            "shadow-blur": 18,
            "shadow-color": "#2563eb",
            "shadow-opacity": 0.48,
            opacity: 1,
            "z-index": 30
        }
    },
    {
        selector: "node.is-context-match",
        style: { "border-width": 3, "border-color": "#38bdf8", opacity: 0.82, "z-index": 20 }
    },
    {
        selector: "node.is-dimmed",
        style: { color: "#94a3b8", "border-color": "#cbd5e1", opacity: 0.16, "z-index": 1 }
    },
    { selector: "edge.is-dimmed", style: { opacity: 0.08 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": "#0f172a" } }
];

export function createGraphView({ container, worker, onOpen, tooltip }) {
    const cytoscape = globalThis.cytoscape;
    if (typeof cytoscape !== "function") throw new Error("CYTOSCAPE_UNAVAILABLE");
    const cy = cytoscape({
        container,
        elements: [],
        style: STYLE,
        layout: { name: "preset" },
        minZoom: 0.08,
        maxZoom: 3,
        wheelSensitivity: 0.2,
        pixelRatio: 1,
        hideEdgesOnViewport: true,
        textureOnViewport: true
    });
    let layoutRequest = 0;
    let lastTap = { id: null, time: 0 };
    let searchElements = cy.collection();
    let nonPcMode = false;

    const hideTooltip = () => tooltip?.classList.add("hidden");
    const showTooltip = node => {
        const summary = String(node.data("summary") || "").trim();
        if (!tooltip || !summary) return hideTooltip();
        tooltip.textContent = summary;
        tooltip.classList.remove("hidden");
        const position = node.renderedPosition();
        const width = tooltip.offsetWidth || 280;
        const height = tooltip.offsetHeight || 80;
        tooltip.style.left = `${Math.max(8, Math.min(container.clientWidth - width - 8, position.x + 14))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(container.clientHeight - height - 8, position.y + 14))}px`;
    };
    const fit = (elements, padding, duration) => {
        if (!elements?.length) return;
        if (cy.nodes().length > 5_000) cy.fit(elements, padding);
        else cy.animate({ fit: { eles: elements, padding }, duration });
    };

    worker.addEventListener("message", event => {
        if (event.data?.type !== "layout-result" || event.data.requestId !== layoutRequest) return;
        const positions = new Map(event.data.positions.map(position => [position.id, position]));
        cy.batch(() => cy.nodes().positions(node => positions.get(node.id()) || node.position()));
        fit(cy.elements(), 55, 420);
    });

    cy.on("mouseover", 'node[kind = "item"]', event => {
        if (!nonPcMode) showTooltip(event.target);
    });
    cy.on("mouseout", 'node[kind = "item"]', () => {
        if (!nonPcMode) hideTooltip();
    });
    cy.on("tap", "node", event => {
        const now = performance.now();
        const node = event.target;
        const id = node.id();
        const doubleTap = lastTap.id === id && now - lastTap.time < 360;
        if (nonPcMode && !doubleTap) showTooltip(node);
        if (doubleTap && node.data("path")) {
            hideTooltip();
            onOpen(node.data("path"));
        }
        lastTap = { id, time: now };
    });
    cy.on("tap", event => {
        if (event.target === cy) hideTooltip();
    });
    cy.on("pan zoom", hideTooltip);

    function render({ nodes, edges }) {
        nodes = nodes.slice(0, MAX_GRAPH_NODES);
        const nodeIds = new Set(nodes.map(node => node.id));
        edges = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, MAX_GRAPH_EDGES);
        const existingIds = new Set(cy.elements().map(element => element.id()));
        const nextIds = new Set([...nodes.map(node => node.id), ...edges.map(edge => edge.id)]);
        hideTooltip();
        cy.batch(() => {
            cy.elements().filter(element => !nextIds.has(element.id())).remove();
            cy.add([
                ...nodes.filter(node => !existingIds.has(node.id)).map(node => ({ group: "nodes", data: node })),
                ...edges.filter(edge => !existingIds.has(edge.id)).map(edge => ({ group: "edges", data: edge }))
            ]);
            nodes.forEach(node => cy.getElementById(node.id).data(node));
            edges.forEach(edge => cy.getElementById(edge.id).data(edge));
        });
        layoutRequest += 1;
        worker.postMessage({ type: "layout", requestId: layoutRequest, nodes, edges, iterations: layoutIterationsFor(nodes.length) });
    }

    function applyHighlights({ direct, context, dimmed }) {
        cy.batch(() => {
            cy.elements().removeClass("is-direct-match is-context-match is-dimmed");
            direct.forEach(id => cy.getElementById(id).addClass("is-direct-match"));
            context.forEach(id => cy.getElementById(id).addClass("is-context-match"));
            dimmed.forEach(id => cy.getElementById(id).addClass("is-dimmed"));
            cy.edges().forEach(edge => {
                if (dimmed.has(edge.source().id()) && dimmed.has(edge.target().id())) edge.addClass("is-dimmed");
            });
        });
        searchElements = cy.nodes(".is-direct-match, .is-context-match");
    }

    return {
        setNonPcTypography(nonPc) {
            nonPcMode = Boolean(nonPc);
            hideTooltip();
            const style = cy.style();
            style.selector("node").style("font-size", nonPc ? 20 : 9);
            style.selector('node[kind = "category"]').style({ "font-size": nonPc ? 22 : 13, width: nonPc ? 280 : 190, height: nonPc ? 130 : 86, "text-max-width": nonPc ? 250 : 166 });
            style.selector('node[kind = "subcategory"]').style({ "font-size": nonPc ? 20 : 12, width: nonPc ? 250 : 165, height: nonPc ? 112 : 74, "text-max-width": nonPc ? 220 : 145 });
            style.selector('node[kind = "item"]').style({ "font-size": nonPc ? 20 : 10, width: nonPc ? 270 : 158, height: nonPc ? 136 : 82, "text-max-width": nonPc ? 240 : 140 });
            style.selector("node.is-direct-match").style("font-size", nonPc ? 22 : 10);
            style.update();
        },
        render,
        applyHighlights,
        clearHighlights() {
            cy.elements().removeClass("is-direct-match is-context-match is-dimmed");
            searchElements = cy.collection();
        },
        fitSearch() {
            fit(searchElements, 50, 450);
        },
        fitAll() {
            fit(cy.elements(), 55, 420);
        },
        zoomBy(factor) {
            hideTooltip();
            const selected = cy.nodes(":selected").first();
            const animation = { zoom: cy.zoom() * factor, duration: 180 };
            if (selected.length) animation.center = { eles: selected };
            cy.animate(animation);
        },
        center(path) {
            const node = cy.getElementById(path);
            if (node.length) cy.animate({ center: { eles: node }, zoom: 1.2, duration: 420 });
        },
        setPanEnabled(enabled) {
            cy.userPanningEnabled(enabled);
            cy.boxSelectionEnabled(!enabled);
        },
        destroy() {
            hideTooltip();
            cy.destroy();
        }
    };
}
