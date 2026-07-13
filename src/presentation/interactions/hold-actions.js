// Presentation interaction: 탭의 길게 누르기 제스처 상태만 관리합니다.
export const TAB_TOUCH_HOLD_DELAY = 1000;

export function createHoldActions({ delay = TAB_TOUCH_HOLD_DELAY, onOpen, onClose, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timerId = null;
    let isOpen = false;
    const cancelTimer = () => { if (timerId !== null) clearTimer(timerId); timerId = null; };
    const open = () => { cancelTimer(); isOpen = true; onOpen(); };
    const start = () => { cancelTimer(); timerId = setTimer(open, delay); };
    const close = () => { cancelTimer(); if (!isOpen) return; isOpen = false; onClose(); };
    const cancel = () => { cancelTimer(); if (isOpen) close(); };
    return { start, open, close, cancel, isOpen: () => isOpen };
}
