// Application: IndexedDB의 최신 대기 항목을 묶어 Firestore에 제한적으로 동기화합니다.
function isConflict(error) {
    return error?.code === "MEMO_CONFLICT" || error?.message === "MEMO_CONFLICT";
}

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
                let result;
                try {
                    result = await remoteRepository.save(userId, local.payload, options);
                } catch (error) {
                    // 스냅샷 도착 경합만 한 번 현재 문서 기준으로 재시도합니다. 무한 재시도는 하지 않습니다.
                    if (!isConflict(error) || options.expectedRevision === null) throw error;
                    result = await remoteRepository.save(userId, local.payload, {
                        expectedRevision: null,
                        allowCreate
                    });
                }
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
        flush: sync
    };
}
