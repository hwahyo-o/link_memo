import { isGuestSession, usesRemotePersistence } from "../../domain/auth/session-policy.js";

// Processing layer: coordinates durable exit/logout writes without depending on DOM or Firebase SDK details.
export function createLifecycleSyncService({
    getSession,
    waitForUploads,
    ensureRemoteImages = async () => {},
    persistLatest,
    flushFirebase,
    loadDurable,
    saveCheckpoint,
    saveCheckpointKeepalive
}) {
    let exitPersist = null;
    let durableFlush = null;

    function canSync(session, userId = session?.user?.uid) {
        return Boolean(usesRemotePersistence(session?.user) && !session.disabled && session.user.uid === userId);
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

    async function flushGuestLocal(session) {
        await runStage("image-uploads", () => waitForUploads());
        await runStage("local-persist", () => persistLatest());
        return runStage("local-verify", async () => {
            const local = await loadDurable(session.user.uid);
            if (!local?.payload) throw new Error("MEMO_LOCAL_PERSIST_INCOMPLETE");
            return local;
        });
    }

    async function flushRegisteredDurable(session) {
        await runStage("image-uploads", () => waitForUploads());
        await runStage("drive-images", () => ensureRemoteImages());
        await runStage("local-persist", () => persistLatest());
        await runStage("firebase", () => flushFirebase({ throwOnError: true }));
        const synchronized = await runStage("local-verify", () => loadDurable(session.user.uid));
        if (!synchronized?.payload || synchronized.dirty) throw new Error("MEMO_SYNC_INCOMPLETE");
        await runStage("cloudflare-checkpoint", () => saveCheckpoint(session.user, synchronized.payload, Date.now()));
        return synchronized;
    }

    async function performDurableFlush() {
        const session = getSession();
        if (!session?.user) throw new Error("UNAUTHENTICATED");
        return isGuestSession(session.user)
            ? flushGuestLocal(session)
            : flushRegisteredDurable(session);
    }

    function saveNow() {
        if (!durableFlush) {
            durableFlush = performDurableFlush().finally(() => { durableFlush = null; });
        }
        return durableFlush;
    }

    function flushBeforeLogout() {
        return saveNow();
    }

    return { flushForPageExit, saveNow, flushBeforeLogout };
}
