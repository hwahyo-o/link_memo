import { mergeVaultSnapshots } from "../../domain/pkm/vault-policy.js";

export function createPkmSyncService({ localRepository, remoteRepository, scheduler, onSynced = () => {} }) {
    let queue = Promise.resolve();

    async function persist(userId, snapshot) {
        const record = await localRepository.savePending(userId, snapshot);
        scheduler.schedule(() => flush(userId));
        return record;
    }

    function flush(userId) {
        const task = async () => {
            const local = await localRepository.load(userId);
            if (!local?.dirty || !local.version) return { synced: false, snapshot: local?.snapshot || null };
            const remote = await remoteRepository.load(userId);
            const merged = mergeVaultSnapshots(remote?.snapshot, local.snapshot);
            const result = await remoteRepository.save(userId, merged, { previousChunkIds: remote?.chunkIds || [] });
            const acknowledged = await localRepository.acknowledge(userId, local.version, result.revision, merged);
            if (acknowledged) onSynced(structuredClone(merged));
            return { synced: acknowledged, snapshot: merged, revision: result.revision };
        };
        const scheduled = queue.then(task, task);
        queue = scheduled.catch(() => {});
        return scheduled;
    }

    return {
        persist,
        flush,
        async hydrate(userId) {
            const [local, remote] = await Promise.all([localRepository.load(userId), remoteRepository.load(userId)]);
            const merged = mergeVaultSnapshots(remote?.snapshot, local?.snapshot);
            if (merged.files.length && (!local?.snapshot || JSON.stringify(merged) !== JSON.stringify(local.snapshot))) {
                await localRepository.cache(userId, merged, { remoteRevision: remote?.revision || null });
            }
            return { snapshot: merged, dirty: Boolean(local?.dirty), remoteRevision: remote?.revision || null };
        },
        cancel: () => scheduler.cancel()
    };
}
