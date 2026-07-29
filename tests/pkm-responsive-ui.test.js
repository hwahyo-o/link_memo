import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../pkm.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/pkm.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/pkm/app-controller.js", import.meta.url), "utf8");

describe("PKM responsive search and file drawer", () => {
    it("uses only the browser-native search clear control", () => {
        expect(html).toContain('id="graphSearch" type="search"');
        expect(html).not.toContain('id="clearSearch"');
        expect(controller).not.toContain('byId("clearSearch")');
    });

    it("keeps the graph search field at twice its previous height", () => {
        expect(styles).toMatch(/\.search-field\s*\{[^}]*height:\s*84px;/);
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
