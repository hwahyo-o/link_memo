export function isGuestSession(user) {
    return Boolean(user?.isAnonymous);
}

export function usesRemotePersistence(user) {
    return Boolean(user && !isGuestSession(user));
}
