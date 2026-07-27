const MOBILE_PLATFORM_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Silk|webOS/i;
const DESKTOP_PLATFORM_PATTERN = /Windows|Win32|Win64|Linux|CrOS|Chrome OS/i;

export function isNonPcDevice({
    mobileHint = false,
    platform = "",
    userAgent = "",
    maxTouchPoints = 0
} = {}) {
    if (mobileHint) return true;
    if (/Android|iPhone|iPad|iPod|Silk|webOS/i.test(userAgent)) return true;
    if (/iPhone|iPad|iPod/i.test(platform)) return true;
    if (/Mac/i.test(platform) && maxTouchPoints > 1) return true;
    if (DESKTOP_PLATFORM_PATTERN.test(platform) || /Mac/i.test(platform)) return false;
    return MOBILE_PLATFORM_PATTERN.test(userAgent);
}
