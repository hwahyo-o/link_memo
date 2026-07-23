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
        const session = getSession();
        if (!session?.user || session.user.isAnonymous || session.disabled) return false;
        if (keepaliveOnly) return saveCheckpointKeepalive(session.user, session.payload, Date.now());
        try {
            await flushFirebase({ throwOnError: true });
            const durable = await loadDurable(session.user.uid);
            if (durable?.payload) await saveCheckpoint(session.user, durable.payload, Date.now());
            return Boolean(durable?.payload && !durable.dirty);
        } catch {
            return saveCheckpointKeepalive(session.user, session.payload, Date.now());
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
