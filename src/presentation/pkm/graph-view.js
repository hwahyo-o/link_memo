import { layoutIterationsFor, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../../domain/pkm/graph-limits.js";
import { deriveNodeVisualState } from "../../domain/pkm/graph-node-policy.js";

const STYLE = [
    { selector: "node", style: {
        width: "data(width)", height: "data(height)", shape: "round-rectangle",
        "corner-radius": "data(cornerRadius)",
        "background-color": "data(color)", "border-width": "data(visualBorderWidth)",
        "border-color": "data(visualBorderColor)", opacity: "data(visualOpacity)",
        "shadow-offset-x": "data(visualShadowOffsetX)",
        "shadow-offset-y": "data(visualShadowOffsetY)",
        "shadow-blur": "data(visualShadowBlur)",
        "shadow-color": "data(visualShadowColor)", "shadow-opacity": "data(visualShadowOpacity)",
        "overlay-color": "#0f172a", "overlay-opacity": "data(visualDimOverlayOpacity)", "overlay-padding": 0,
        "z-index": "data(visualZIndex)"
    } },
    { selector: "edge", style: {
        width: 1, "line-color": "#94a3b8", "target-arrow-shape": "none",
        "curve-style": "straight", opacity: 0.4, "z-index": 0
    } },
    { selector: 'edge[kind = "category-membership"], edge[kind = "subcategory-membership"]',
        style: { width: 2, "line-color": "#64748b", opacity: 0.68 } },
    { selector: 'edge[kind = "keyword-related"]',
        style: { "line-style": "dashed", "line-color": "#38bdf8", opacity: 0.35 } },
    { selector: "edge.is-search-dimmed", style: { opacity: 0.07 } },
    { selector: "edge.is-overview", style: { display: "none" } }
];

const MATCH_NONE = Object.freeze({ direct: new Set(), context: new Set(), dimmed: new Set() });

export function createGraphView({ container, worker, onOpen, tooltip, dimLayer }) {
    const cytoscape = globalThis.cytoscape;
    if (typeof cytoscape !== "function") throw new Error("CYTOSCAPE_UNAVAILABLE");

    const labelLayer = document.createElement("div");
    labelLayer.className = "graph-node-labels";
    container.append(labelLayer);

    const cy = cytoscape({
        container, elements: [], style: STYLE, layout: { name: "preset" },
        minZoom: 0.08, maxZoom: 4, wheelSensitivity: 0.8, pixelRatio: 1,
        hideEdgesOnViewport: true, textureOnViewport: true
    });

    let layoutRequest = 0;
    let lastTap = { id: null, time: 0 };
    let searchElements = cy.collection();
    let matches = MATCH_NONE;
    let searchActive = false;
    let selectedBeforeSearch = new Set();
    let nonPcMode = false;
    let tooltipPath = null;
    let tooltipTimer = null;
    let labelFrame = 0;

    const cancelTooltipHide = () => clearTimeout(tooltipTimer);
    const hideTooltip = () => {
        cancelTooltipHide();
        tooltipPath = null;
        tooltip?.classList.add("hidden");
    };
    const scheduleTooltipHide = () => {
        cancelTooltipHide();
        tooltipTimer = setTimeout(hideTooltip, 180);
    };
    const openNode = node => {
        const path = node?.data?.("openPath");
        if (path) onOpen(path);
    };
    const showTooltip = node => {
        const summary = String(node.data("summary") || "").trim();
        const path = node.data("openPath");
        if (!tooltip || !summary) return hideTooltip();
        tooltipPath = path || null;
        tooltip.textContent = summary;
        tooltip.disabled = !path;
        tooltip.classList.remove("hidden");
        const position = node.renderedPosition();
        const width = tooltip.offsetWidth || 280;
        const height = tooltip.offsetHeight || 80;
        tooltip.style.left = `${Math.max(8, Math.min(container.clientWidth - width - 8, position.x + 14))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(container.clientHeight - height - 8, position.y + 14))}px`;
    };

    tooltip?.addEventListener("pointerenter", cancelTooltipHide);
    tooltip?.addEventListener("pointerleave", scheduleTooltipHide);
    tooltip?.addEventListener("click", () => {
        if (tooltipPath) onOpen(tooltipPath);
        hideTooltip();
    });

    const fit = (elements, padding, duration) => {
        if (!elements?.length) return;
        if (cy.nodes().length > 5_000) cy.fit(elements, padding);
        else cy.animate({ fit: { eles: elements, padding }, duration });
    };

    const matchFor = id => matches.direct.has(id) ? "direct" : matches.context.has(id) ? "context" : "none";

    function applyVisualStates() {
        const selected = cy.nodes(":selected").first();
        const selectedId = selected.length ? selected.id() : null;
        const hasSelection = Boolean(selectedId);
        cy.batch(() => {
            cy.nodes().forEach(node => {
                const state = deriveNodeVisualState({
                    searchActive, match: matchFor(node.id()), hasSelection,
                    selected: node.id() === selectedId,
                    selectedBeforeSearch: selectedBeforeSearch.has(node.id()),
                    color: node.data("color")
                });
                node.data({
                    visualOpacity: state.opacity,
                    visualBorderWidth: state.borderWidth,
                    visualBorderColor: state.borderColor,
                    visualShadowColor: state.shadowColor,
                    visualShadowOpacity: state.shadowOpacity,
                    visualShadowOffsetX: state.shadowOffsetX,
                    visualShadowOffsetY: state.shadowOffsetY,
                    visualShadowBlur: state.shadowBlur,
                    visualDimOverlayOpacity: state.dimOverlayOpacity,
                    visualZIndex: state.layer === "above" ? 30 : 1
                });
            });
            cy.edges().toggleClass("is-search-dimmed", searchActive);
        });
        dimLayer?.classList.toggle("is-active", searchActive);
        scheduleLabels();
    }

    function syncLabels() {
        labelFrame = 0;
        const zoom = cy.zoom();
        const overview = zoom < 0.28;
        cy.edges().toggleClass("is-overview", overview);
        if (overview) {
            labelLayer.replaceChildren();
            return;
        }
        const bounds = container.getBoundingClientRect();
        const scaledFont = (base, minimum, maximum) => `${Math.round(Math.min(maximum, Math.max(minimum, base * zoom)) * 10) / 10}px`;
        const titleFontSize = scaledFont(nonPcMode ? 20 : 14, nonPcMode ? 14 : 10, nonPcMode ? 64 : 56);
        const keywordFontSize = scaledFont(nonPcMode ? 16 : 10, nonPcMode ? 12 : 8, nonPcMode ? 48 : 40);
        const labels = [];
        cy.nodes().forEach(node => {
            const point = node.renderedPosition();
            if (point.x < -120 || point.y < -80 || point.x > bounds.width + 120 || point.y > bounds.height + 80) return;
            const data = node.data();
            const label = document.createElement("div");
            label.className = "graph-node-label";
            label.style.left = `${point.x}px`;
            label.style.top = `${point.y}px`;
            label.style.width = `${Math.max(80, Number(data.width) * zoom)}px`;
            label.style.opacity = String((data.visualOpacity ?? 1) * (1 - (data.visualDimOverlayOpacity ?? 0)));
            label.style.zIndex = String(data.visualZIndex || 1);
            const title = document.createElement("strong");
            title.style.fontSize = titleFontSize;
            title.textContent = data.title || data.label || "";
            label.append(title);
            if (data.keywordsLabel) {
                const keywords = document.createElement("span");
                keywords.style.fontSize = keywordFontSize;
                keywords.textContent = data.keywordsLabel;
                label.append(keywords);
            }
            labels.push(label);
        });
        labelLayer.replaceChildren(...labels);
    }

    function scheduleLabels() {
        if (!labelFrame) labelFrame = requestAnimationFrame(syncLabels);
    }

    worker.addEventListener("message", event => {
        if (event.data?.type !== "layout-result" || event.data.requestId !== layoutRequest) return;
        const positions = new Map(event.data.positions.map(position => [position.id, position]));
        cy.batch(() => cy.nodes().positions(node => positions.get(node.id()) || node.position()));
        fit(cy.elements(), 55, 420);
        scheduleLabels();
    });

    cy.on("mouseover", "node", event => {
        if (!nonPcMode) {
            cancelTooltipHide();
            showTooltip(event.target);
        }
    });
    cy.on("mouseout", "node", () => {
        if (!nonPcMode) scheduleTooltipHide();
    });
    cy.on("tap", "node", event => {
        const now = performance.now();
        const node = event.target;
        const doubleTap = lastTap.id === node.id() && now - lastTap.time < 380;
        if (doubleTap) {
            hideTooltip();
            openNode(node);
        } else if (nonPcMode) showTooltip(node);
        lastTap = { id: node.id(), time: now };
    });
    cy.on("tap", event => {
        if (event.target === cy) hideTooltip();
    });
    cy.on("select unselect", "node", applyVisualStates);
    cy.on("drag position pan zoom resize", () => {
        scheduleTooltipHide();
        scheduleLabels();
    });

    function render({ nodes, edges }) {
        nodes = nodes.slice(0, MAX_GRAPH_NODES).map(node => ({
            cornerRadius: Math.min(Number(node.width) || 188, Number(node.height) || 68) / 2,
            visualOpacity: 1, visualBorderWidth: 1, visualBorderColor: "#94A3B8",
            visualShadowColor: node.color, visualShadowOpacity: 0,
            visualShadowOffsetX: 3, visualShadowOffsetY: 4, visualShadowBlur: 5,
            visualDimOverlayOpacity: 0,
            visualZIndex: 30, ...node
        }));
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
        applyVisualStates();
        layoutRequest += 1;
        worker.postMessage({ type: "layout", requestId: layoutRequest, nodes, edges, iterations: layoutIterationsFor(nodes.length) });
    }

    function applyHighlights(nextMatches) {
        if (!searchActive) selectedBeforeSearch = new Set(cy.nodes(":selected").map(node => node.id()));
        matches = nextMatches;
        searchActive = true;
        searchElements = cy.collection([
            ...[...matches.direct].map(id => cy.getElementById(id)),
            ...[...matches.context].map(id => cy.getElementById(id))
        ]);
        applyVisualStates();
    }

    return {
        setNonPcTypography(nonPc) {
            nonPcMode = Boolean(nonPc);
            container.classList.toggle("is-non-pc", nonPcMode);
            hideTooltip();
            scheduleLabels();
        },
        render,
        applyHighlights,
        clearHighlights() {
            matches = MATCH_NONE;
            searchActive = false;
            selectedBeforeSearch = new Set();
            searchElements = cy.collection();
            applyVisualStates();
        },
        fitSearch() { fit(searchElements, 50, 450); },
        fitAll() { fit(cy.elements(), 55, 420); },
        zoomBy(factor) {
            hideTooltip();
            const selected = cy.nodes(":selected").first();
            const animation = { zoom: cy.zoom() * factor, duration: 160 };
            if (selected.length) animation.center = { eles: selected };
            cy.animate(animation);
        },
        center(path) {
            const node = cy.getElementById(path);
            if (node.length) cy.animate({ center: { eles: node }, zoom: Math.max(1.2, cy.zoom()), duration: 420 });
        },
        setPanEnabled(enabled) {
            cy.userPanningEnabled(enabled);
            cy.boxSelectionEnabled(!enabled);
        },
        destroy() {
            hideTooltip();
            cancelAnimationFrame(labelFrame);
            labelLayer.remove();
            cy.destroy();
        }
    };
}
