import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../workers/drive-api/src/index.js", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../workers/drive-api/wrangler.jsonc", import.meta.url), "utf8");

describe("Drive deployment contract", () => {
    it("blocks Pages deployment when Drive frontend configuration is missing", () => {
        expect(workflow).toContain('test -n "$VITE_GOOGLE_OAUTH_CLIENT_ID"');
        expect(workflow).toContain('test -n "$VITE_DRIVE_WORKER_URL"');
    });

    it("checks the deployed Drive Worker before building Pages", () => {
        expect(workflow).toContain("Verify Drive Worker compatibility");
        expect(workflow).toContain('/v1/health');
        expect(workflow).toContain('value.service === "link-memo-drive"');
    });

    it("preserves dashboard-managed Worker variables during deployment", () => {
        expect(wrangler).toContain('"keep_vars": true');
    });

    it("exposes only a non-sensitive readiness response", () => {
        expect(worker).toContain('path === "v1/health"');
        expect(worker).toContain('{ service: "link-memo-drive", apiVersion: 1, ready: true, status: "ready" }');
        expect(worker).toContain('ready: false, status: "configuration"');
        expect(worker).toContain('ready: false, status: "storage"');
        expect(worker).not.toMatch(/v1\/health[\s\S]{0,500}(GOOGLE_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY).*json\(/);
    });
});
