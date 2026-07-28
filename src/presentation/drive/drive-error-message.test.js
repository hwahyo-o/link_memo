import { describe, expect, it } from "vitest";
import { getDriveErrorMessage } from "./drive-error-message.js";

describe("Drive error messages", () => {
    it("distinguishes missing deployment configuration from network failure", () => {
        expect(getDriveErrorMessage(new Error("DRIVE_WORKER_URL_MISSING"))).toContain("배포에 포함되지 않았습니다");
        expect(getDriveErrorMessage(new Error("DRIVE_WORKER_UNREACHABLE"))).toContain("네트워크를 확인");
    });

    it("gives an actionable message for an expired Drive grant", () => {
        expect(getDriveErrorMessage(new Error("DRIVE_TOKEN_REFRESH_FAILED"))).toContain("다시 승인");
    });

    it("does not expose unknown error details", () => {
        expect(getDriveErrorMessage(new Error("sensitive internal detail"))).toBe("Google Drive 연결 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    });
});
