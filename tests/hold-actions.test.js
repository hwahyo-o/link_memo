import { describe, expect, it, vi } from 'vitest';
import { createHoldActions, TAB_ACTION_DELAY } from '../src/features/tabs/hold-actions.js';

describe('createHoldActions', () => {
    it('opens only after the three-second delay', () => {
        vi.useFakeTimers();
        const onOpen = vi.fn();
        const controller = createHoldActions({ onOpen, onClose: vi.fn() });
        controller.start();
        vi.advanceTimersByTime(TAB_ACTION_DELAY - 1);
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
        vi.advanceTimersByTime(TAB_ACTION_DELAY);
        expect(onOpen).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
