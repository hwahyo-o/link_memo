// Application: IndexedDB의 최신 대기 항목을 Firestore에 순차 동기화합니다.
export function createMemoSyncService({ localRepository, remoteRepository, onError = console.error }) {
    let revision = null;
    let queue = Promise.resolve();

    const sync = (userId, { allowCreate = false } = {}) => {
        const run = async () => {
            const local = await localRepository.load(userId);
            if (!local?.dirty || !local.version) return { synced: false, revision };
            try {
                const result = await remoteRepository.save(userId, local.payload, {
                    expectedRevision: revision ?? local.remoteRevision ?? null,
                    allowCreate
                });
                revision = result.revision;
                const acknowledged = await localRepository.acknowledge(userId, local.version, revision);
                return { synced: acknowledged, revision };
            } catch (error) {
                onError(error);
                throw error;
            }
        };
        const scheduled = queue.then(run, run);
        queue = scheduled.catch(() => {});
        return scheduled;
    };

    return {
        setRevision(value) {
            revision = value ?? null;
        },

        sync,

        async flush(userId, options) {
            try {
                return await sync(userId, options);
            } catch {
                return { synced: false, revision };
            }
        }
    };
}
