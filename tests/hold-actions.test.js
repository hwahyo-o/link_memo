import { describe, expect, it, vi } from 'vitest';
import { createHoldActions, TAB_TOUCH_HOLD_DELAY } from '../src/features/tabs/hold-actions.js';

describe('createHoldActions', () => {
    it('opens immediately when requested directly', () => {
        const onOpen = vi.fn();
        const controller = createHoldActions({ onOpen, onClose: vi.fn() });
        controller.open();
        expect(onOpen).toHaveBeenCalledOnce();
    });
    it('opens touch actions only after the one-second hold', () => {
        vi.useFakeTimers();
        const onOpen = vi.fn();
        const controller = createHoldActions({ onOpen, onClose: vi.fn() });
        controller.start();
        vi.advanceTimersByTime(TAB_TOUCH_HOLD_DELAY - 1);
        expect(onOpen).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onOpen).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });

    it('cancels a pending open', () => {
        vi.useFakeTimers();
        const onOpen = vi.fn();
        const controller = createHoldActions({ onOpen, onClose: vi.fn() });
        controller.start();
        controller.cancel();
        vi.advanceTimersByTime(TAB_TOUCH_HOLD_DELAY);
        expect(onOpen).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
