import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../pkm.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/pkm.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/pkm/app-controller.js", import.meta.url), "utf8");
const graphView = readFileSync(new URL("../src/presentation/pkm/graph-view.js", import.meta.url), "utf8");
const graphWorker = readFileSync(new URL("../src/application/pkm/graph-worker.js", import.meta.url), "utf8");

describe("PKM responsive search and file drawer", () => {
    it("keeps an explicit clear control visible while a query exists", () => {
        expect(html).toContain('id="graphSearch" type="search"');
        expect(html).toContain('id="clearGraphSearch"');
        expect(html).toContain('class="search-clear hidden"');
        expect(styles).toContain(".search-field input::-webkit-search-cancel-button { display: none; }");
        expect(controller).toContain('byId("clearGraphSearch").classList.toggle("hidden", !query.trim())');
        expect(controller).toContain('byId("clearGraphSearch").addEventListener("click"');
    });

    it("prevents flex shrink with a responsive 42px to 52px minimum", () => {
        expect(styles).toContain("--search-field-min-size: 42px");
        expect(styles).toContain("clamp(42px, calc(56.545px - 1.4205vw), 52px)");
        expect(styles).toMatch(/\.search-field\s*\{[^}]*min-block-size:\s*var\(--search-field-min-size\)/);
        expect(styles).not.toMatch(/\.search-field\s*\{[^}]*height:/);
    });

    it("reserves header action width without covering search modes", () => {
        expect(styles).toContain("grid-template-columns: auto auto minmax(360px, 760px) max-content");
        expect(styles).toMatch(/\.search-field\s*\{[^}]*min-width:\s*0/);
        expect(styles).toMatch(/\.header-actions\s*\{[^}]*min-width:\s*max-content/);
        expect(styles).toContain("@media (max-width: 1024px)");
    });

    it("keeps shared typography and the 4px title-to-hashtag hierarchy", () => {
        expect(styles).toContain(".file-row[aria-current=\"page\"] { font-size: 20px; font-weight: 400; }");
        expect(styles).toContain("#schemaSummary { font-size: 18px; font-weight: 700; }");
        expect(styles).toContain(".editor-toolbar .small-button { font-size: 16px; font-weight: 400; }");
        expect(styles).toContain(".brand h1 { font-size: 16px; }");
        expect(styles).toContain(".graph-node-label strong {");
        expect(styles).toContain("font-size: 14px; font-weight: 800");
        expect(styles).toContain(".graph-node-label span {");
        expect(styles).toContain("font-size: 10px; font-weight: 500");
        expect(styles).toContain(".graph-canvas.is-non-pc .graph-node-label strong { font-size: 20px; }");
        expect(styles).toContain(".graph-canvas.is-non-pc .graph-node-label span { font-size: 16px; }");
        expect(styles).toContain(".graph-node-label { position: absolute; display: grid; box-sizing: border-box;");
        expect(styles).toContain(".graph-dim-layer.is-active { background: rgb(15 23 42 / 24%); }");
        expect(styles).toContain(".graph-canvas { position: absolute; z-index: 1;");
        expect(styles).toContain(".graph-dim-layer { position: absolute; z-index: 0;");
        expect(styles).toContain("#fileTree .file-group-label,");
        expect(styles).toContain("#fileTree .file-row[aria-current=\"page\"] { font-size: 18px; }");
        expect(graphView).toContain("setNonPcTypography(nonPc)");
        expect(graphView).toContain('cy.on("drag position pan zoom resize"');
        expect(graphView).toContain('"overlay-opacity": "data(visualDimOverlayOpacity)"');
        expect(graphView).toContain("visualDimOverlayOpacity: state.dimOverlayOpacity");
        expect(graphView).toContain('"corner-radius": "data(cornerRadius)"');
        expect(graphView).toContain("cornerRadius: Math.min");
        expect(graphView).toContain('shape: "round-rectangle"');
        expect(graphView).toContain("const scaledFont = (base, minimum, maximum)");
        expect(graphView).toContain("title.style.fontSize = titleFontSize");
        expect(graphView).toContain("keywords.style.fontSize = keywordFontSize");
        expect(graphWorker).toContain("findFreePosition");
        expect(graphWorker).toContain("goldenAngle");
        expect(graphWorker).not.toContain("target.x + minX");
        expect(controller).toContain("graphView.setNonPcTypography(deviceIsNonPc())");
    });

    it("uses the shared non-PC breakpoint for an explicit file drawer", () => {
        expect(html).toContain('id="toggleFileDrawer"');
        expect(html).toContain('aria-controls="filePanel"');
        expect(html).toContain('id="filePanelBackdrop"');
        expect(styles).toContain("@media (max-width: 1024px)");
        expect(styles).toContain(".file-panel.is-open");
        expect(styles).not.toContain("calc(-100% + 38px)");
        expect(styles).not.toContain(".file-panel:focus-within");
        expect(controller).toContain("const setFileDrawerOpen = open =>");
        expect(controller).toContain('event.target.closest(".file-row")');
        expect(controller).toContain("subscribeNonPcViewport");
    });
});
