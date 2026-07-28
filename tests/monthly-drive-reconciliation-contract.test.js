import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/presentation/app-controller.js", import.meta.url), "utf8");
const driveWorker = readFileSync(new URL("../workers/drive-api/src/index.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../workers/drive-api/schema.sql", import.meta.url), "utf8");
const backupWorker = readFileSync(new URL("../cloudflare-backup-worker/src/index.js", import.meta.url), "utf8");

describe("monthly Drive reconciliation contract", () => {
    it("exposes one-image carousel deletion for pointer and keyboard users", () => {
        expect(html).toContain('id="previewImageDeleteButton"');
        expect(styles).toMatch(/\.image-carousel-delete\s*\{/);
        expect(controller).toContain("deleteCurrentPreviewImage");
        expect(controller).toContain("removeImageAttachment");
    });

    it("keeps disconnect behavior outside this implementation", () => {
        expect(controller).toContain("window.disconnectGoogleDrive = () =>");
        expect(controller).toContain("Drive에 이미 저장된 이미지 파일은 삭제하지 않습니다.");
    });

    it("wires KST reconciliation and account cleanup endpoints", () => {
        expect(driveWorker).toContain('path === "images/reconcile"');
        expect(driveWorker).toContain('path === "images/reconcile/defer"');
        expect(driveWorker).toContain('path === "images/reconcile/restore"');
        expect(driveWorker).toContain('path === "account"');
        expect(schema).toContain("drive_reconciliation_state");
        expect(backupWorker).toContain('url.pathname === "/v1/account"');
    });
});
