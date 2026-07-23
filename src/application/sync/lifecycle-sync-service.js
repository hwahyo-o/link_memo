// Processing layer: coordinates durable exit/logout writes without depending on DOM or Firebase SDK details.
export function createLifecycleSyncService({
    getSession,
    waitForUploads,
    persistLatest,
    flushFirebase,
    loadDurable,
    saveCheckpoint,
    saveCheckpointKeepalive
}) {
    let exitPersist = null;

    function canSync(session, userId = session?.user?.uid) {
        return Boolean(session?.user && !session.user.isAnonymous && !session.disabled && session.user.uid === userId);
    }

    async function persistForExit() {
        if (!exitPersist) {
            exitPersist = Promise.resolve().then(persistLatest).finally(() => { exitPersist = null; });
        }
        await exitPersist;
        return getSession();
    }

    async function runStage(syncStage, task) {
        try {
            return await task();
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            error.syncStage ||= syncStage;
            throw error;
        }
    }

    async function flushForPageExit({ keepaliveOnly = false } = {}) {
        const initial = getSession();
        if (!canSync(initial)) return false;
        try {
            const session = await persistForExit();
            if (!canSync(session, initial.user.uid)) return false;
            if (keepaliveOnly) return saveCheckpointKeepalive(session.user, session.payload, Date.now());
            await flushFirebase({ throwOnError: true });
            const durable = await loadDurable(session.user.uid);
            if (durable?.payload) await saveCheckpoint(session.user, durable.payload, Date.now());
            return Boolean(durable?.payload && !durable.dirty);
        } catch {
            const session = getSession();
            return canSync(session, initial.user.uid)
                ? saveCheckpointKeepalive(session.user, session.payload, Date.now())
                : false;
        }
    }

    async function flushBeforeLogout() {
        const session = getSession();
        if (!session?.user) throw new Error("UNAUTHENTICATED");
        await runStage("image-uploads", () => waitForUploads());
        await runStage("local-persist", () => persistLatest());
        await runStage("firebase", () => flushFirebase({ throwOnError: true }));
        const durable = await runStage("local-verify", () => loadDurable(session.user.uid));
        if (!durable?.payload || durable.dirty) throw new Error("MEMO_SYNC_INCOMPLETE");
        if (!session.user.isAnonymous) {
            await runStage("cloudflare-checkpoint", () => saveCheckpoint(session.user, durable.payload, Date.now()));
        }
        return durable;
    }

    return { flushForPageExit, flushBeforeLogout };
}
