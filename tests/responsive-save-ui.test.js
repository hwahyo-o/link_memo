import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/app-controller.js", import.meta.url), "utf8");

describe("responsive save header", () => {
    it("uses the supported Font Awesome Graph icon", () => {
        expect(html).toContain("font-awesome/6.7.2/css/all.min.css");
        expect(html).toContain("fa-solid fa-hexagon-nodes");
        expect(html).not.toContain("fa-solid fa-share-nodes");
    });

    it("keeps home, actions, account and title in explicit layout regions", () => {
        expect(html).toContain('class="main-header-grid"');
        expect(html).toContain('class="main-header-actions"');
        expect(html).toContain('id="userInfoDisplay" class="main-header-user');
        expect(css).toContain("@media (max-width: 640px)");
        expect(css.slice(0, css.indexOf("@import"))).not.toContain("!important");
    });

    it("contains the requested password-login guidance", () => {
        expect(controller).toContain("이미지 및 데이터 등의 더 원활한 데이터 관리를 원하실 경우 구글 계정 연동을 진행해주세요.");
    });
});
