import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/memos.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/app-controller.js", import.meta.url), "utf8");

describe("content preview contract", () => {
    it("stacks the image carousel before the comment viewer without tabs", () => {
        expect(html.indexOf('id="previewImageStage"')).toBeLessThan(html.indexOf('id="previewTextStage"'));
        expect(html).toContain('id="previewContent" class="image-preview-content"');
        expect(html).toContain('id="previewTextHeading"');
        expect(html).not.toContain('id="previewTabs"');
        expect(html).not.toContain('id="previewTextTab"');
        expect(html).not.toContain('id="previewImageTab"');
    });

    it("shows image and text stages independently for combined previews", () => {
        expect(controller).toContain("previewImageStage.classList.toggle('hidden', !hasImage)");
        expect(controller).toContain("previewTextStage.classList.toggle('hidden', !hasText)");
        expect(controller).not.toContain("setPreviewMode");
    });

    it("keeps the modal vertically scrollable and wraps long comments", () => {
        expect(styles).toMatch(/\.image-preview-content\s*\{[^}]*overflow-y:\s*auto/s);
        expect(styles).toMatch(/\.preview-text-content\s*\{[^}]*max-width:\s*100%/s);
        expect(styles).toMatch(/\.preview-text-content\s*\{[^}]*white-space:\s*pre-wrap/s);
        expect(styles).toMatch(/\.preview-text-content\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });
});
