import { afterEach, describe, expect, it, vi } from "vitest";
import { createDriveWorkerImageRepository } from "./drive-worker-image-repository.js";

afterEach(() => vi.unstubAllGlobals());

function createAuth() {
    return { currentUser: { getIdToken: vi.fn(async force => force ? "fresh-token" : "cached-token") } };
}

describe("Drive Worker requests", () => {
    it("refreshes the Firebase token once after a 401 response", async () => {
        const auth = createAuth();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        vi.stubGlobal("fetch", fetchMock);
        const repository = createDriveWorkerImageRepository({ auth, baseUrl: "https://drive.invalid" });

        await repository.disconnect();

        expect(auth.currentUser.getIdToken).toHaveBeenNthCalledWith(1, false);
        expect(auth.currentUser.getIdToken).toHaveBeenNthCalledWith(2, true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("classifies browser network and CORS failures without exposing details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
        const repository = createDriveWorkerImageRepository({ auth: createAuth(), baseUrl: "https://drive.invalid" });

        await expect(repository.disconnect()).rejects.toMatchObject({ message: "DRIVE_WORKER_UNREACHABLE" });
    });

    it("fails before requesting a token when the deployment URL is missing", async () => {
        const auth = createAuth();
        const repository = createDriveWorkerImageRepository({ auth, baseUrl: "" });

        await expect(repository.disconnect()).rejects.toThrow("DRIVE_WORKER_URL_MISSING");
        expect(auth.currentUser.getIdToken).not.toHaveBeenCalled();
    });
});
