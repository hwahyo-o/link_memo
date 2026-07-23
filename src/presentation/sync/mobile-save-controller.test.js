import { describe, expect, it, vi } from "vitest";
import { createMobileSaveController } from "./mobile-save-controller.js";

function createElements() {
    const classes = new Set(["hidden"]);
    return {
        button: {
            classList: {
                toggle(name, force) {
                    if (force) classes.add(name);
                    else classes.delete(name);
                },
                contains: name => classes.has(name)
            },
            setAttribute: vi.fn(),
            disabled: false,
            title: ""
        },
        icon: { className: "" },
        status: { textContent: "" }
    };
}

describe("mobile save controller", () => {
    it("shows the button only for a registered account", () => {
        const elements = createElements();
        const controller = createMobileSaveController({
            ...elements,
            getUser: () => null,
            saveNow: vi.fn(),
            alert: vi.fn(),
            storage: { getItem: vi.fn(), setItem: vi.fn() },
            isMobile: () => true
        });

        controller.updateVisibility({ isAnonymous: true });
        expect(elements.button.classList.contains("hidden")).toBe(true);
        controller.updateVisibility({ isAnonymous: false });
        expect(elements.button.classList.contains("hidden")).toBe(false);
    });

    it("shows onboarding once per browser storage", () => {
        const elements = createElements();
        const values = new Map();
        const storage = {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value)
        };
        const alert = vi.fn();
        const timers = [];
        const options = {
            ...elements,
            getUser: () => ({ isAnonymous: false }),
            saveNow: vi.fn(),
            alert,
            storage,
            isMobile: () => true,
            setTimer: task => { timers.push(task); }
        };
        const controller = createMobileSaveController(options);

        expect(controller.maybeShowOnboarding()).toBe(true);
        expect(controller.maybeShowOnboarding()).toBe(false);
        timers.shift()();
        expect(alert).toHaveBeenCalledWith(expect.stringContaining("세이브 버튼"));

        const nextSession = createMobileSaveController(options);
        expect(nextSession.maybeShowOnboarding()).toBe(false);
    });

    it("coalesces rapid taps into one durable save", async () => {
        const elements = createElements();
        let releaseSave;
        const saveNow = vi.fn(() => new Promise(resolve => { releaseSave = resolve; }));
        const timers = [];
        const controller = createMobileSaveController({
            ...elements,
            getUser: () => ({ isAnonymous: false }),
            saveNow,
            alert: vi.fn(),
            storage: { getItem: vi.fn(() => "1"), setItem: vi.fn() },
            isMobile: () => true,
            setTimer: task => { timers.push(task); }
        });

        const first = controller.save();
        const second = controller.save();
        expect(second).toBe(first);
        await vi.waitFor(() => expect(saveNow).toHaveBeenCalledTimes(1));
        releaseSave();

        await expect(first).resolves.toBe(true);
        expect(elements.button.disabled).toBe(true);
        timers.shift()();
        expect(elements.button.disabled).toBe(false);
        expect(elements.status.textContent).toContain("즉시 저장");
    });
});
