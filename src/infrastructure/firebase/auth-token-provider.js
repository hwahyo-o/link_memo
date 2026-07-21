export function createFirebaseTokenProvider({ getUser } = {}) {
    let currentUser = null;
    let cachedToken = null;
    const updateUser = user => {
        if (currentUser?.uid !== user?.uid) cachedToken = null;
        currentUser = user || null;
    };
    const getToken = async ({ forceRefresh = false } = {}) => {
        const user = currentUser || getUser?.();
        if (!user) throw new Error("UNAUTHENTICATED");
        cachedToken = await user.getIdToken(forceRefresh);
        return cachedToken;
    };
    return { updateUser, getToken, peekToken: () => cachedToken };
}
