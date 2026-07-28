export const NON_PC_MAX_VIEWPORT_WIDTH = 1024;
export const NON_PC_MEDIA_QUERY = `(max-width: ${NON_PC_MAX_VIEWPORT_WIDTH}px)`;

// Core rule: device labels and user-agent strings do not affect the save control.
export function isNonPcDevice({ viewportWidth } = {}) {
    const width = Number(viewportWidth);
    return Number.isFinite(width) && width > 0 && width <= NON_PC_MAX_VIEWPORT_WIDTH;
}
