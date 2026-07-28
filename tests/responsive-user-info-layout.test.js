import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const mobileHeaderCss = css.slice(css.indexOf("@media (max-width: 640px)"), css.indexOf("@import url('./styles/tabs.css')"));

describe("mobile user info layout", () => {
    it("keeps the user label and logout action on one row", () => {
        expect(mobileHeaderCss).toMatch(/\.main-header-user\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
        expect(mobileHeaderCss).not.toMatch(/\.main-header-user\s*{[^}]*flex-wrap:/s);
    });

    it("truncates long user labels without shrinking the logout action", () => {
        expect(mobileHeaderCss).toMatch(/\.main-header-user span\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
        expect(mobileHeaderCss).toMatch(/\.main-header-user button\s*{[^}]*margin-left:\s*0;[^}]*white-space:\s*nowrap;/s);
    });
});
