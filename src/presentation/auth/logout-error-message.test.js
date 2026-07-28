import { describe, expect, it } from "vitest";
import { getLogoutErrorMessage } from "./logout-error-message.js";

describe("logout error message", () => {
    it("explains a mismatched backup Worker deployment", () => {
        expect(getLogoutErrorMessage({
            message: "NOT_FOUND",
            syncStage: "cloudflare-checkpoint"
        })).toContain("연결 주소 또는 API");
    });

    it("describes a guest local persistence failure without blaming the cloud", () => {
        expect(getLogoutErrorMessage({
            message: "MEMO_LOCAL_PERSIST_INCOMPLETE",
            syncStage: "local-verify"
        })).toContain("로컬 저장 공간");
    });

    it("describes an image queue failure as local storage", () => {
        expect(getLogoutErrorMessage({
            message: "IMAGE_LOCAL_SAVE_INCOMPLETE",
            syncStage: "image-uploads"
        })).toContain("이 기기에 저장");
    });

    it("does not mislabel an earlier sync failure as Cloudflare", () => {
        expect(getLogoutErrorMessage({
            message: "offline",
            syncStage: "firebase"
        })).toContain("네트워크 연결");
    });
});
