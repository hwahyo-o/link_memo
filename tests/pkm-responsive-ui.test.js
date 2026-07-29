import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../pkm.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/pkm.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/pkm/app-controller.js", import.meta.url), "utf8");
const graphView = readFileSync(new URL("../src/presentation/pkm/graph-view.js", import.meta.url), "utf8");

describe("PKM responsive search and file drawer", () => {
    it("uses only the browser-native search clear control", () => {
        expect(html).toContain('id="graphSearch" type="search"');
        expect(html).not.toContain('id="clearSearch"');
        expect(controller).not.toContain('byId("clearSearch")');
    });

    it("prevents flex shrink with a responsive 42px to 63px minimum", () => {
        expect(styles).toContain("--search-field-min-size: 42px");
        expect(styles).toContain("clamp(42px, calc(72.55px - 2.983vw), 63px)");
        expect(styles).toMatch(/\.search-field\s*\{[^}]*min-block-size:\s*var\(--search-field-min-size\)/);
        expect(styles).not.toMatch(/\.search-field\s*\{[^}]*height:/);
    });

    it("scales non-PC text without changing the title or icon sizes", () => {
        expect(styles).toContain("font-size: 20px");
        expect(styles).toContain("font-size: 22px");
        expect(styles).toContain("font-size: 24px");
        expect(styles).toContain(".brand h1 { font-size: 16px; }");
        expect(graphView).toContain("setNonPcTypography(nonPc)");
        expect(graphView).toContain('nonPc ? 20 : 9');
        expect(graphView).toContain('nonPc ? 22 : 10');
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
