import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdleSyncScheduler } from "./idle-sync-scheduler.js";

afterEach(() => vi.useRealTimers());

describe("idle sync scheduler", () => {
    it("runs once after the full idle window", async () => {
        vi.useFakeTimers();
        const task = vi.fn();
        const scheduler = createIdleSyncScheduler({ delay: 180000 });

        scheduler.schedule(task);
        await vi.advanceTimersByTimeAsync(179999);
        expect(task).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("restarts the idle window on every change", async () => {
        vi.useFakeTimers();
        const task = vi.fn();
        const scheduler = createIdleSyncScheduler({ delay: 180000 });

        scheduler.schedule(task);
        await vi.advanceTimersByTimeAsync(120000);
        scheduler.schedule(task);
        await vi.advanceTimersByTimeAsync(179999);
        expect(task).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(task).toHaveBeenCalledTimes(1);
    });
});
