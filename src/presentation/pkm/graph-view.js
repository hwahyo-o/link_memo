const STYLE = [
    {
        selector: "node",
        style: {
            width: 50,
            height: 50,
            label: "data(label)",
            "font-family": "Inter, Pretendard, Noto Sans KR, sans-serif",
            "font-size": 9,
            "font-weight": 650,
            color: "#334155",
            "text-wrap": "ellipsis",
            "text-max-width": 78,
            "text-valign": "center",
            "text-halign": "center",
            "background-color": "#e2e8f0",
            "border-width": 1,
            "border-color": "#94a3b8",
            opacity: 0.92
        }
    },
    {
        selector: "edge",
        style: {
            width: 1,
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
            "target-arrow-shape": "triangle",
            "curve-style": "straight",
            opacity: 0.46
        }
    },
    {
        selector: "node.is-direct-match",
        style: {
            width: 66,
            height: 66,
            color: "#ffffff",
            "font-size": 10,
            "font-weight": 800,
            "background-color": "#2563eb",
            "border-width": 3,
            "border-color": "#bfdbfe",
            "shadow-blur": 18,
            "shadow-color": "#2563eb",
            "shadow-opacity": 0.55,
            opacity: 1,
            "z-index": 30
        }
    },
    {
        selector: "node.is-context-match",
        style: {
            width: 57,
            height: 57,
            color: "#075985",
            "background-color": "#dff6ff",
            "border-width": 2,
            "border-color": "#38bdf8",
            opacity: 0.72,
            "z-index": 20
        }
    },
    {
        selector: "node.is-dimmed",
        style: {
            color: "#94a3b8",
            "background-color": "#e5e7eb",
            "border-color": "#cbd5e1",
            opacity: 0.18,
            "z-index": 1
        }
    },
    {
        selector: "edge.is-dimmed",
        style: { opacity: 0.09 }
    },
    {
        selector: "node:selected",
        style: {
            "border-width": 4,
            "border-color": "#0f172a"
        }
    }
];

export function createGraphView({ container, worker, onOpen }) {
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

    worker.addEventListener("message", event => {
        if (event.data?.type !== "layout-result" || event.data.requestId !== layoutRequest) return;
        const positions = new Map(event.data.positions.map(position => [position.id, position]));
        cy.batch(() => cy.nodes().positions(node => positions.get(node.id()) || node.position()));
        cy.animate({ fit: { eles: cy.elements(), padding: 55 }, duration: 420 });
    });

    cy.on("tap", "node", event => {
        const now = performance.now();
        const id = event.target.id();
        if (lastTap.id === id && now - lastTap.time < 360) onOpen(event.target.data("path"));
        lastTap = { id, time: now };
    });

    function render({ nodes, edges }) {
        nodes = nodes.slice(0, 10_000);
        const nodeIds = new Set(nodes.map(node => node.id));
        edges = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, 50_000);
        const existingIds = new Set(cy.elements().map(element => element.id()));
        const nextIds = new Set([...nodes.map(node => node.id), ...edges.map(edge => edge.id)]);
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
        worker.postMessage({ type: "layout", requestId: layoutRequest, nodes, edges, iterations: nodes.length > 3000 ? 18 : 36 });
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
            const style = cy.style();
            style.selector("node").style("font-size", nonPc ? 20 : 9);
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
            if (searchElements.length) cy.animate({ fit: { eles: searchElements, padding: 50 }, duration: 450 });
        },
        fitAll() {
            cy.animate({ fit: { eles: cy.elements(), padding: 55 }, duration: 420 });
        },
        zoomBy(factor) {
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
            cy.destroy();
        }
    };
}
