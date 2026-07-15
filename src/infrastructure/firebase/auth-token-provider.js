export function createFirebaseTokenProvider({ getUser } = {}) {
    let currentUser = null;
    const updateUser = user => { currentUser = user || null; };
    const getToken = async ({ forceRefresh = false } = {}) => {
        const user = currentUser || getUser?.();
        if (!user) throw new Error("UNAUTHENTICATED");
        return user.getIdToken(forceRefresh);
    };
    return { updateUser, getToken };
}
