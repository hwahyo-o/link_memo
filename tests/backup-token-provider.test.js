import { describe, expect, it, vi } from "vitest";
import { createFirebaseTokenProvider } from "../src/infrastructure/firebase/auth-token-provider.js";

describe("Firebase backup token provider", () => {
  it("reuses the current Firebase user and supports forced refresh", async () => {
    const getIdToken = vi.fn()
      .mockResolvedValueOnce("normal-token")
      .mockResolvedValueOnce("refreshed-token");
    const user = { getIdToken };
    const provider = createFirebaseTokenProvider();
    provider.updateUser(user);
    await expect(provider.getToken()).resolves.toBe("normal-token");
    await expect(provider.getToken({ forceRefresh: true })).resolves.toBe("refreshed-token");
    expect(getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
  });
});
