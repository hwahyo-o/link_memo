import { auth, onAuthStateChanged } from "../infrastructure/firebase/auth-gateway.js";
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";
import { createIndexedDbMemoRepository } from "../infrastructure/browser/indexeddb-memo-repository.js";
import { createIdleSyncScheduler } from "../application/memos/idle-sync-scheduler.js";
import { createMemoSyncService } from "../application/memos/memo-sync-service.js";
import { createVault } from "../application/pkm/vault.js";
import { createMetadataCache } from "../application/pkm/metadata-cache.js";
import { createPkmSyncService } from "../application/pkm/pkm-sync-service.js";
import { createPkmImageUploader } from "../application/pkm/pkm-image-uploader.js";
import { createIndexedDbVaultRepository } from "../infrastructure/pkm/indexeddb-vault-repository.js";
import { createFirestoreVaultRepository } from "../infrastructure/pkm/firestore-vault-repository.js";
import { createFirestoreMemoRepository } from "../infrastructure/firestore/memo-repository.js";
import { discoverLocalSchemas, discoverMainMemoPayload } from "../infrastructure/pkm/schema-discovery.js";
import { createDriveWorkerImageRepository } from "../infrastructure/http/drive-worker-image-repository.js";
import { createDriveImageService } from "../application/drive/drive-image-service.js";
import { createGoogleDriveCodeProvider } from "../infrastructure/google/google-drive-code-provider.js";
import { createCloudflareBackupRepository } from "../infrastructure/http/cloudflare-backup-repository.js";
import { createBackupService } from "../application/backups/backup-service.js";
import { createFirebaseTokenProvider } from "../infrastructure/firebase/auth-token-provider.js";
import { createPkmApp } from "../presentation/pkm/app-controller.js";

const graphWorker = new Worker(new URL("../application/pkm/graph-worker.js", import.meta.url), { type: "module" });
const metadataCache = createMetadataCache({ worker: graphWorker });
const vault = createVault();
const localVaultRepository = createIndexedDbVaultRepository();
const remoteVaultRepository = createFirestoreVaultRepository();
const pkmSync = createPkmSyncService({
    localRepository: localVaultRepository,
    remoteRepository: remoteVaultRepository,
    scheduler: createIdleSyncScheduler({ delay: 3 * 60 * 1000 }),
    onSynced: (snapshot, userId) => {
        if (auth?.currentUser?.uid === userId) vault.replace(snapshot);
    }
});

const localMemoRepository = createIndexedDbMemoRepository();
const memoSync = createMemoSyncService({
    localRepository: localMemoRepository,
    remoteRepository: createFirestoreMemoRepository(),
    onError: () => {}
});
const tokenProvider = createFirebaseTokenProvider({ getUser: () => auth?.currentUser });
const backupService = createBackupService({
    cloudRepository: createCloudflareBackupRepository({ tokenProvider })
});
const driveService = createDriveImageService({
    localImageRepository: imageRepository,
    driveImageRepository: createDriveWorkerImageRepository({ auth }),
    driveCodeProvider: createGoogleDriveCodeProvider()
});
let driveConnection = null;

async function discoverMainMemo(userId) {
    const discovered = await discoverMainMemoPayload(userId);
    if (auth?.currentUser?.uid === userId) driveConnection = discovered?.payload?.driveConnection || null;
    return discovered;
}

async function saveMainNow(user) {
    const result = await memoSync.flush(user.uid);
    if (user.isAnonymous || !backupService.configured()) return result;
    const local = await localMemoRepository.load(user.uid);
    if (local?.payload && !local.dirty) {
        await backupService.saveCheckpoint({ user, payload: local.payload, updatedAt: Date.now() });
    }
    return result;
}

const uploadImage = createPkmImageUploader({
    getCurrentUser: () => auth?.currentUser,
    localImageRepository: imageRepository,
    driveImageService: driveService,
    getDriveConnection: () => driveConnection,
    setDriveConnection: connection => { driveConnection = connection; }
});

createPkmApp({
    auth,
    onAuthStateChanged,
    vault,
    metadataCache,
    graphWorker,
    pkmSync,
    pkmRemoteRepository: remoteVaultRepository,
    discoverLocalSchemas,
    discoverMainMemo,
    saveMainNow,
    uploadImage
});
