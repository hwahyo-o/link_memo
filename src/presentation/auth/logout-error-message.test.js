import { describe, expect, it } from "vitest";
import { getLogoutErrorMessage } from "./logout-error-message.js";

describe("logout error message", () => {
    it("explains a mismatched backup Worker deployment", () => {
        expect(getLogoutErrorMessage({
            message: "NOT_FOUND",
            syncStage: "cloudflare-checkpoint"
        })).toContain("연결 주소 또는 API");
    });

    it("does not mislabel an earlier sync failure as Cloudflare", () => {
        expect(getLogoutErrorMessage({
            message: "offline",
            syncStage: "firebase"
        })).toContain("네트워크 연결");
    });
});
