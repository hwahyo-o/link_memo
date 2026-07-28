import { NON_PC_MEDIA_QUERY } from "../../domain/sync/device-policy.js";

export function readViewportProfile({
    innerWidth = globalThis.innerWidth,
    documentElement = globalThis.document?.documentElement
} = {}) {
    const viewportWidth = Number(innerWidth) || Number(documentElement?.clientWidth) || Number.POSITIVE_INFINITY;
    return { viewportWidth };
}

export function subscribeNonPcViewport(listener, { matchMedia = globalThis.matchMedia } = {}) {
    if (typeof matchMedia !== "function") return () => {};
    const media = matchMedia(NON_PC_MEDIA_QUERY);
    const notify = () => listener(media.matches);
    if (typeof media.addEventListener === "function") media.addEventListener("change", notify);
    else media.addListener?.(notify);
    return () => {
        if (typeof media.removeEventListener === "function") media.removeEventListener("change", notify);
        else media.removeListener?.(notify);
    };
}
