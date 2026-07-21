// Application: IndexedDB의 최신 대기 항목을 묶어 Firestore에 제한적으로 동기화합니다.
export function createMemoSyncService({ localRepository, remoteRepository, onError = console.error }) {
    let revision = null;
    let queue = Promise.resolve();

    const sync = (userId, { allowCreate = false } = {}) => {
        const run = async () => {
            const local = await localRepository.load(userId);
            if (!local?.dirty || !local.version) return { synced: false, revision };

            const options = {
                expectedRevision: revision ?? local.remoteRevision ?? null,
                allowCreate
            };
            try {
                const result = await remoteRepository.save(userId, local.payload, options);
                revision = result.revision;
                const acknowledged = await localRepository.acknowledge(userId, local.version, revision);
                if (acknowledged && result.payload) {
                    await localRepository.cache(userId, result.payload, { remoteRevision: revision });
                }
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
        flush: sync
    };
}

