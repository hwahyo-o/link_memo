export function readBrowserDeviceProfile({
    navigator: browserNavigator = globalThis.navigator,
    matchMedia: browserMatchMedia = globalThis.matchMedia
} = {}) {
    return {
        mobileHint: browserNavigator?.userAgentData?.mobile === true,
        platform: browserNavigator?.userAgentData?.platform || browserNavigator?.platform || "",
        userAgent: browserNavigator?.userAgent || "",
        maxTouchPoints: Number(browserNavigator?.maxTouchPoints || 0),
        coarsePointer: browserMatchMedia?.("(pointer: coarse)")?.matches === true
    };
}
