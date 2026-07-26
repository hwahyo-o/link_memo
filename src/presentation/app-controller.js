import {
    signInWithCustomToken, signInAnonymously, onAuthStateChanged, onIdTokenChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    GoogleAuthProvider, signInWithPopup, EmailAuthProvider, linkWithCredential,
    linkWithPopup, reauthenticateWithCredential, reauthenticateWithPopup,
    deleteUser, auth, hasFirebaseConfig
} from "../infrastructure/firebase/auth-gateway.js";
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";
import { createIndexedDbMemoRepository } from "../infrastructure/browser/indexeddb-memo-repository.js";
import { createMemoService } from "../application/memos/memo-service.js";
import { createMemoSyncService } from "../application/memos/memo-sync-service.js";
import { createIdleSyncScheduler } from "../application/memos/idle-sync-scheduler.js";
import { createImageAttachmentQueue } from "../application/memos/image-attachment-queue.js";
import { createFirestoreMemoRepository } from "../infrastructure/firestore/memo-repository.js";
import { getMemoPreviewKind, isCommentOnlyMemo, normalizeHttpUrl, normalizeMemoInput } from "../domain/memos/memo-policy.js";
import { getLinkImages, hasLinkImages, normalizeLinkImages, validateImageSelection } from "../domain/memos/image-attachment-policy.js";
import { relocateLink } from "../application/memos/link-relocation-service.js";
import { createModalController } from "./components/modal.js";
import { createHoldActions } from "./interactions/hold-actions.js";
import { createDefaultDriveConnection, canUseDrive, normalizeDriveConnection } from "../domain/drive/drive-connection.js";
import { createGoogleDriveCodeProvider } from "../infrastructure/google/google-drive-code-provider.js";
import { createDriveWorkerImageRepository } from "../infrastructure/http/drive-worker-image-repository.js";
import { createDriveImageService } from "../application/drive/drive-image-service.js";
import { createCloudflareBackupRepository } from "../infrastructure/http/cloudflare-backup-repository.js";
import { createBackupService } from "../application/backups/backup-service.js";
import { createManualBackupSyncService } from "../application/backups/manual-backup-sync-service.js";
import { createBackupState, addBackupSuccess, getBackupList, validateImportedBackup } from "../domain/backups/backup-policy.js";
import { createFirebaseTokenProvider } from "../infrastructure/firebase/auth-token-provider.js";
import { getLatestKstBackupSlot, getNextKstBackupSlot, getKstSlotKey } from "../domain/backups/backup-schedule-policy.js";
import { isSameMemoPayload, mergeMemoPayloads, prepareLocalMemoPayload } from "../domain/sync/memo-merge-policy.js";
import { createLifecycleSyncService } from "../application/sync/lifecycle-sync-service.js";
import { getLogoutErrorMessage } from "./auth/logout-error-message.js";
import { createMobileSaveController } from "./sync/mobile-save-controller.js";
import { isNonPcDevice } from "../domain/sync/device-policy.js";
import { readBrowserDeviceProfile } from "../infrastructure/browser/device-profile.js";
import { createPkmSyncService } from "../application/pkm/pkm-sync-service.js";
import { createIndexedDbVaultRepository } from "../infrastructure/pkm/indexeddb-vault-repository.js";
import { createFirestoreVaultRepository } from "../infrastructure/pkm/firestore-vault-repository.js";

const memoRepository = createFirestoreMemoRepository();
const localMemoRepository = createIndexedDbMemoRepository();
const memoSyncService = createMemoSyncService({
    localRepository: localMemoRepository,
    remoteRepository: memoRepository,
    onError: () => {}
});
const memoService = createMemoService({ imageRepository });
const driveCodeProvider = createGoogleDriveCodeProvider();
const driveImageRepository = createDriveWorkerImageRepository({ auth });
const driveImageService = createDriveImageService({
    localImageRepository: imageRepository,
    driveImageRepository,
    driveCodeProvider
});
const backupTokenProvider = createFirebaseTokenProvider({ getUser: () => currentUser });
const cloudBackupRepository = createCloudflareBackupRepository({ tokenProvider: backupTokenProvider });
const backupService = createBackupService({ cloudRepository: cloudBackupRepository });
const manualBackupSyncService = createManualBackupSyncService({
    backupService,
    memoRepository,
    localRepository: localMemoRepository,
    onCleanupError: (...args) => console.warn(...args)
});
const imageAttachmentQueue = createImageAttachmentQueue({
    saveLocalImage: file => saveImageFile(file),
    uploadDriveImage: file => saveDriveImage(file),
    createAttachmentId: () => createId('image'),
    canUploadToDrive: () => canUseDrive(driveConnection),
    concurrency: 2
});
const lifecycleSyncService = createLifecycleSyncService({
    getSession: () => ({
        user: currentUser,
        disabled: isDeletingAccount,
        payload: latestCheckpointPayload || cloneMemoPayload(buildMemoPayload())
    }),
    waitForUploads: () => Promise.allSettled([...pendingImageTasks]),
    persistLatest: () => saveDataInBackground(),
    flushFirebase: options => flushMemoSync(options),
    loadDurable: userId => localMemoRepository.load(userId),
    saveCheckpoint: (user, payload, updatedAt) => {
        if (!backupService.configured()) throw new Error('BACKUP_WORKER_URL_MISSING');
        return backupService.saveCheckpoint({ user, payload, updatedAt });
    },
    saveCheckpointKeepalive: (user, payload, updatedAt) => backupService.saveCheckpointKeepalive({ user, payload, updatedAt })
});

const DEFAULT_CATEGORIES = ['ì—…ë¬´', 'í•™ìŠµ', 'ê°œì¸', 'ë„êµ¬', 'ê¸°íƒ€'];
const DEFAULT_COLUMNS = 3;
const VALID_COLUMNS = [3, 4, 5, 6];
const BACKUP_LEASE_KEY = 'link-memo:auto-backup-lease';
const BACKUP_AUTO_ATTEMPT_KEY = 'link-memo:auto-backup-attempt';
const BACKUP_LEASE_MS = 10 * 60 * 1000;
const MEMO_SYNC_IDLE_MS = 3 * 60 * 1000;
const SYNC_DEVICE_KEY = 'link-memo:sync-device-id';

function getSyncDeviceId() {
    try {
        const existing = localStorage.getItem(SYNC_DEVICE_KEY);
        if (existing) return existing;
        const created = crypto.randomUUID?.() || `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(SYNC_DEVICE_KEY, created);
        return created;
    } catch {
        return `session_${crypto.randomUUID?.() || Date.now()}`;
    }
}

const syncDeviceId = getSyncDeviceId();
let syncSequence = 0;

const memoSyncScheduler = createIdleSyncScheduler({ delay: MEMO_SYNC_IDLE_MS });
const backgroundPkmSync = createPkmSyncService({
    localRepository: createIndexedDbVaultRepository(),
    remoteRepository: createFirestoreVaultRepository(),
    scheduler: createIdleSyncScheduler({ delay: MEMO_SYNC_IDLE_MS })
});
const { customAlert, customConfirm, customPrompt } = createModalController();
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.customPrompt = customPrompt;
const loginScreen = document.getElementById('loginScreen');
const homeLanding = document.getElementById('homeLanding');
const mainApp = document.getElementById('mainApp');
const homeUserInfoDisplay = document.getElementById('homeUserInfoDisplay');
const userInfoDisplay = document.getElementById('userInfoDisplay');
const mobileSaveButton = document.getElementById('mobileSaveButton');
const mobileSaveIcon = document.getElementById('mobileSaveIcon');
const mobileSaveStatus = document.getElementById('mobileSaveStatus');
const imageInput = document.getElementById('linkImage');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewName = document.getElementById('imagePreviewName');
const imagePreviewModal = document.getElementById('imagePreviewModal');
const imagePreviewModalImg = document.getElementById('imagePreviewModalImg');
const imagePreviewModalTitle = document.getElementById('imagePreviewModalTitle');
const previewTabs = document.getElementById('previewTabs');
const previewTextTab = document.getElementById('previewTextTab');
const previewImageTab = document.getElementById('previewImageTab');
const previewTextStage = document.getElementById('previewTextStage');
const previewImageStage = document.getElementById('previewImageStage');
const previewTextContent = document.getElementById('previewTextContent');
const carouselPreviousButton = document.getElementById('carouselPreviousButton');
const carouselNextButton = document.getElementById('carouselNextButton');
const carouselCounter = document.getElementById('carouselCounter');
const carouselControls = document.getElementById('carouselControls');
const carouselLoading = document.getElementById('carouselLoading');
const settingsModal = document.getElementById('settingsModal');
const darkModeToggle = document.getElementById('darkModeToggle');
const categoryFolderGrid = document.getElementById('categoryFolderGrid');
const accountDeleteModal = document.getElementById('accountDeleteModal');
const accountDeletePhrase = document.getElementById('accountDeletePhrase');
const accountDeletePasswordWrap = document.getElementById('accountDeletePasswordWrap');
const accountDeletePassword = document.getElementById('accountDeletePassword');
const accountDeleteStatus = document.getElementById('accountDeleteStatus');
const accountDeleteConfirmBtn = document.getElementById('accountDeleteConfirmBtn');
const driveRepairButton = document.getElementById('driveRepairButton');
const driveDisconnectButton = document.getElementById('driveDisconnectButton');
const driveSyncStatus = document.getElementById('driveSyncStatus');
const backupStatus = document.getElementById('backupStatus');
const backupList = document.getElementById('backupList');
const backupFileInput = document.getElementById('backupFileInput');
const manualBackupButton = document.getElementById('manualBackupButton');
const linkEditModal = document.getElementById('linkEditModal');
const linkEditText = document.getElementById('linkEditText');
const linkEditCategory = document.getElementById('linkEditCategory');
const linkEditSubcategory = document.getElementById('linkEditSubcategory');

let currentUser = null;
let dataLoadState = 'loading';
let memoRevision = null;
let backupInfo = null;
let backupState = createBackupState();
let syncMeta = null;
let latestCheckpointPayload = null;
const pendingImageTasks = new Set();
let isBackupListExpanded = false;
// ë³€ê²½ ì—†ìŒ/ì‹¤íŒ¨ ìƒíƒœëŠ” Firestore ì›ë³¸ ë¬¸ì„œì— ì„žì§€ ì•Šê³  í˜„ìž¬ ë¸Œë¼ìš°ì € ì„¸ì…˜ì—ì„œë§Œ í‘œì‹œí•©ë‹ˆë‹¤.
let automaticBackupRuntime = null;
let guestBackupNoticeShown = false;
let backupTimer = null;
let backupAuthReady = false;
let backupCatalogLoaded = false;
let backupSessionStartedAt = null;
let nextAutomaticBackupAt = null;
const backupTabId = crypto.randomUUID?.() || `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let saveQueue = Promise.resolve();
let localWriteQueue = Promise.resolve();
let pendingLocalSaveCount = 0;
let localMemoDirty = false;
let backupQueue = Promise.resolve();
let dataSafetyAlertShown = false;
let unsubscribeSnapshot = null;
let categories = [...DEFAULT_CATEGORIES];
let activeTab = categories[0];
let linkData = {};
let uiPreferences = createDefaultPreferences(activeTab);
let draggedItem = null;
let draggedTab = null;
let activeTabActionController = null;
let draggedSubcategoryId = null;
let isFirstLoad = true;
let homeRenderSignature = null;
let isDeletingAccount = false;
let selectedImageFiles = [];
let editingLinkContext = null;
let previewObjectUrl = null;
let modalObjectUrl = null;
let previewAttachments = [];
let previewItem = null;
let previewImageIndex = 0;
let carouselPointerStartX = null;
let queuedImageSaveTimer = null;
let previewRequestId = 0;
let hoverPreviewTimer = null;
let longPressTimer = null;
let deleteReauthMode = 'none';
let driveConnection = createDefaultDriveConnection();
let drivePromptRequested = false;
const repairingDriveImageIds = new Set();
const mobileSaveController = createMobileSaveController({
    button: mobileSaveButton,
    icon: mobileSaveIcon,
    status: mobileSaveStatus,
    getUser: () => currentUser,
    saveNow: () => Promise.all([
        lifecycleSyncService.saveNow(),
        currentUser ? backgroundPkmSync.flush(currentUser.uid) : Promise.resolve()
    ]),
    alert: customAlert,
    isNonPc: () => isNonPcDevice(readBrowserDeviceProfile())
});
window.handleMobileSave = () => { void mobileSaveController.save(); };

function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function acquireAutomaticBackupLease(scheduledFor) {
    try {
        const now = Date.now();
        const current = JSON.parse(localStorage.getItem(BACKUP_LEASE_KEY) || 'null');
        if (current?.scheduledFor === scheduledFor && current.expiresAt > now && current.owner !== backupTabId) return false;
        localStorage.setItem(BACKUP_LEASE_KEY, JSON.stringify({ owner: backupTabId, scheduledFor, expiresAt: now + BACKUP_LEASE_MS }));
        return JSON.parse(localStorage.getItem(BACKUP_LEASE_KEY) || 'null')?.owner === backupTabId;
    } catch { return true; }
}
function releaseAutomaticBackupLease(scheduledFor, keepUntilExpiry = false) {
    try {
        const current = JSON.parse(localStorage.getItem(BACKUP_LEASE_KEY) || 'null');
        if (!keepUntilExpiry && current?.owner === backupTabId && current?.scheduledFor === scheduledFor) localStorage.removeItem(BACKUP_LEASE_KEY);
    } catch {}
}
function readAutomaticBackupAttempt() {
    try {
        const value = JSON.parse(localStorage.getItem(BACKUP_AUTO_ATTEMPT_KEY) || 'null');
        return value?.userId === currentUser?.uid ? value : null;
    } catch {
        return null;
    }
}
function getLastAutomaticComparisonSlot() {
    const localAttempt = readAutomaticBackupAttempt();
    return Math.max(
        Number(localAttempt?.scheduledFor || 0),
        Number(automaticBackupRuntime?.lastScheduledFor || 0),
        Number(backupState.auto?.lastScheduledFor || 0),
        Number(backupState.auto?.lastAttemptScheduledFor || 0)
    );
}
function getAutomaticBackupStatus() {
    const persisted = backupState.auto || {};
    if (Number(automaticBackupRuntime?.lastAttemptAt || 0) <= Number(persisted.lastAttemptAt || 0)) return persisted;
    return { ...persisted, ...automaticBackupRuntime };
}
function recordAutomaticBackupAttempt(scheduledFor, { status = 'running', attemptedAt = Date.now(), error = null } = {}) {
    if (!currentUser?.uid || !scheduledFor) return;
    const lastStatus = status === 'created' ? 'success' : status;
    automaticBackupRuntime = {
        lastAttemptAt: attemptedAt,
        lastStatus,
        lastError: error,
        lastScheduledFor: scheduledFor
    };
    try {
        localStorage.setItem(BACKUP_AUTO_ATTEMPT_KEY, JSON.stringify({
            userId: currentUser.uid,
            scheduledFor,
            attemptedAt,
            status,
            error
        }));
    } catch {}
}
function mergeßM8îÚ$z{-®éÜj×’ÙZÞºªžÉyÈIÎ¸©BÉÛNºûŽÊxº[ÂÊ	Î«ÙZÈ‰‚ÉxnÈ«^¸¸Ž¸ºBâr“°¢7W7FöÔ6öæf—&Ò‚~Ë*Ž»hÉÛNºûŽÊxº[ÂÊ	Î«ÙYŽÈ¹Î«*È«^¸¸Ž«˜ÃòrÂ7–æ2‚’Óâ°¢6öç7B&VÖ÷fVD–ÖvW2ÒvWDÆ–æ´–ÖvW2†Æ–æ²“°¢Æ–æ²æ–ÖvW2ÒµÓ°¢Æ–æ²çWFFVDBÒFFRææ÷r‚“°¢v—B6fTFF–ä&6¶w&÷VæB‚“°¢&VæFW$Æ–æ·2‚“°¢&VÖ÷fTÆ–æ´–ÖvW4–ä&6¶w&÷VæB…·²–ÖvW3¢&VÖ÷fVD–ÖvW2ÕÒ“°¢Ò“°§Ó° ¦gVæ7F–öâf÷&ÖD&6·WF–ÖR‡fÇVR’²&WGW&âfÇVRòæWr–çFÂäFFUF–ÖTf÷&ÖB‚v¶òÔµ"rÇ¶FFU7G–ÆS¢vÖVF—VÒrÇF–ÖU7G–ÆS¢w6†÷'BrÇF–ÖU¦öæS¢t6–õ6V÷VÂwÒ’æf÷&ÖB†æWrFFR‡fÇVR’’¢rÒs²Ð¦gVæ7F–öâ&VæFW$&6·W6WGF–æw2‚’°¢–b‚&6·W7FGW2ÇÂ&6·WÆ—7B’&WGW&ã°¢–b†7W'&VçEW6W#òæ—4æöç–Ö÷W2’°¢&6·W7FGW2çFW‡D6öçFVçCÒ~«(ÎÈªNØ«‚«8NÊ	^ÉØ»ÉxR»ò»;^É¹ÉØBÉÛNÉªžÙZÈ‰‚ÉxnÈ«^¸¸Ž¸ºBâvöövÆR«8NÊ	^ÉØBÉ{¸ùžÙ[NÊ;ÎÈKŽÉ©Bâs°¢&6·WÆ—7Bæ–ææW$…DÔÃÒrs°¢&WGW&ã°¢Ð ¢6öç7BWFóÖvWDWFöÖF–4&6·W7FGW2‚“°¢6öç7B7W'&VçE6W76–öäf–ÇW&SÖWFòæÆ7E7FGW3ÓÓÒvf–ÇW&Rrbb‚&6·W6W76–öå7F'FVDBÇÂ†WFòæÆ7DGFV×DBbbWFòæÆ7DGFV×DBãÒ&6·W6W76–öå7F'FVDB’“°¢6öç7B7W'&VçE6W76–öåVæ6†ævVCÖWFòæÆ7E7FGW3ÓÓÒwVæ6†ævVBrbb‚&6·W6W76–öå7F'FVDBÇÂ†WFòæÆ7DGFV×DBbbWFòæÆ7DGFV×DBãÒ&6·W6W76–öå7F'FVDB’“°¢&6·W7FGW2çFW‡D6öçFVçCÒ&6·WWF…&VG¢ò~ºÎ«{ŽÉÛ‚ÉÛŽÊiÞÉØBÊH»˜NÙYŽ¸©BÊIÉè^¸¸Ž¸ºBâ»ÉxR«‹¸ª^ÉÛB«:rÙ™ÎÈKÙ™N¹
ž¸¸Ž¸ºBâp¢¢7W'&VçE6W76–öäf–ÇW&P¢òÉé¸ù’»ÉxRÈºNØÊƒ¢G¶WFòæÆ7DW'&÷'ÇÂ~É¹ÉÛŽÉØBÙ™^ÉÛŽÙ[NÊ;ÎÈKŽÉ©BâwÖ ¢¢7W'&VçE6W76–öåVæ6†ævV@¢òËYÎ«{ÂÉé¸ù’»ÉxRÙ™^ÉÛƒ¢È8ŽºÞ«(Â»ÉxRÙZ¸+NÉªžÉÛBÉxnÈ«^¸¸Ž¸ºBâ+r¸ºNÉØÂ»ÉxS¢G¶f÷&ÖD&6·WF–ÖR†æW‡DWFöÖF–4&6·WB—Ö ¢¢WFòæÆ7E7V66W74Bbb‚&6·W6W76–öå7F'FVDBÇÂWFòæÆ7E7V66W74BãÒ&6·W6W76–öå7F'FVDB¢òËYÎ«{ÂÉé¸ù’»ÉxRÈK«;S¢G¶f÷&ÖD&6·WF–ÖR†WFòæÆ7E7V66W74B—Ò+r¸ºNÉØÂ»ÉxS¢G¶f÷&ÖD&6·WF–ÖR†æW‡DWFöÖF–4&6·WB—Ö ¢¢»ÉxRÉÛŽÊiÞÉÛBÊH»˜N¹	ŽÉxŽÈ«^¸¸Ž¸ºBâ¸ºNÉØÂÉé¸ù’»ÉxS¢G¶f÷&ÖD&6·WF–ÖR†æW‡DWFöÖF–4&6·WB—Ö° ¢6öç7B&6·W2ÒvWD&6·WÆ—7B†&6·W7FFR“°¢6öç7Bf—6–&ÆT&6·W2Ò—4&6·WÆ—7DW‡æFVBò&6·W2¢&6·W2ç6Æ–6RƒÂ2“°¢&6·WÆ—7Bæ–ææW$…DÔÃÒrs°¢–b‚&6·W2æÆVæwF‚’&6·WÆ—7Bæ–ææW$…DÔÃÒsÇ6Æ73Ò'FW‡B×‡2FW‡BÖw&’ÓS#îÊÉê^¹	ÂÈ‰Ž¸ù’¹‰¸©BÉé¸ù’»Éx^ÉÛBÉxnÈ«^¸¸Ž¸ºBãÂ÷âs° ¢f—6–&ÆT&6·W2æf÷$V6‚†&6·WÓâ°¢6öç7B—FVÓÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢—FVÒæ6Æ74æÖSÒw&÷VæFVB&÷&FW"&÷&FW"Öw&’Ó#Ó2fÆW‚fÆW‚Ö6öÂ6Ó¦fÆW‚×&÷r6Ó¦—FV×2Ö6VçFW"6Ó¦§W7F–g’Ö&WGvVVâvÓ"s°¢—FVÒæ–ææW$…DÔÃÖÆF—cãÇ6Æ73Ò&föçB×6VÖ–&öÆBFW‡B×6ÒFW‡BÖw&’Óƒ#âG¶&6·Wç&V6öãÓÓÒvÖçVÂsò~È‰Ž¸ù’s¢~Éé¸ù’wÒ»ÉxSÂ÷ãÇ6Æ73Ò'FW‡B×‡2FW‡BÖw&’ÓS#âG¶f÷&ÖD&6·WF–ÖR†&6·Wæ7&VFVDB—Ò+rG´ÖF‚æ6V–Â‚†&6·Wç6—¦WÇÃ’ó#B—Ô´#Â÷ãÂöF—cãÆF—b6Æ73Ò&fÆW‚vÓ"#ãÆ'WGFöâ6Æ73Ò&&6·WÖF÷væÆöB6V6öæF'’Ö6öÖÖæB&÷&FW"&÷&FW"Ö&ÇVRÓ3FW‡BÖ&ÇVRÓs‚Ó2’ÓãR&÷VæFVBFW‡B×6Ò"FFÖ–CÒ"G¶&6·Wæ–GÒ#î¸ºNÉ«NºÎ¹9ÃÂö'WGFöããÆ'WGFöâ6Æ73Ò&&6·W×&W7F÷&R6V6öæF'’Ö6öÖÖæB&÷&FW"&÷&FW"ÖVÖW&ÆBÓ3FW‡BÖVÖW&ÆBÓs‚Ó2’ÓãR&÷VæFVBFW‡B×6Ò"FFÖ–CÒ"G¶&6·Wæ–GÒ#î»;^É¹Âö'WGFöããÂöF—cæ°¢&6·WÆ—7BæVæD6†–ÆB†—FVÒ“°¢Ò“° ¢–b†&6·W2æÆVæwF‚â2’°¢6öç7BÖ÷&T'WGFöãÖFö7VÖVçBæ7&VFTVÆVÖVçB‚v'WGFöâr“°¢Ö÷&T'WGFöâçG—SÒv'WGFöâs°¢Ö÷&T'WGFöâæ6Æ74æÖSÒwrÖgVÆÂFW‡B×6ÒFW‡BÖ&ÇVRÓs&÷&FW"&÷&FW"Ö&ÇVRÓ#&÷VæFVB‚Ó2’Ó"†÷fW#¦&rÖ&ÇVRÓSs°¢Ö÷&T'WGFöâçFW‡D6öçFVçCÖ—4&6·WÆ—7DW‡æFVCò~Ê	«‹s¦¸ÙN»;N«‹‚G¶&6·W2æÆVæwF‚Ò7Þ«	Â–°¢Ö÷&T'WGFöâæöæ6Æ–6³Ò‚“Óç²—4&6·WÆ—7DW‡æFVCÒ—4&6·WÆ—7DW‡æFVC²&VæFW$&6·W6WGF–æw2‚“²Ó°¢&6·WÆ—7BæVæD6†–ÆB†Ö÷&T'WGFöâ“°¢Ð ¢&6·WÆ—7BçVW'•6VÆV7F÷$ÆÂ‚ræ&6·WÖF÷væÆöBr’æf÷$V6‚†'WGFöãÓæ'WGFöâæöæ6Æ–6³Ò‚“Óçv–æF÷ræF÷væÆöD6Æ÷VD&6·W†'WGFöâæFF6WBæ–B’“°¢&6·WÆ—7BçVW'•6VÆV7F÷$ÆÂ‚ræ&6·W×&W7F÷&Rr’æf÷$V6‚†'WGFöãÓæ'WGFöâæöæ6Æ–6³Ò‚“Óçv–æF÷rç&W7F÷&T6Æ÷VD&6·W†'WGFöâæFF6WBæ–B’“°§Ð¦7–æ2gVæ7F–öâÇ”&6·W–ÆöB‡–ÆöB’°¢6FVv÷&–W3Ô'&’æ—4'&’‡–ÆöBæ6FVv÷&–W2“÷–ÆöBæ6FVv÷&–W3¥²ââäDTdTÅEô4DTtõ$”U5Ó²Æ–æ´FF×–ÆöBæÆ–æ´FFbgG—Vöb–ÆöBæÆ–æ´FFÓÓÒvö&¦V7Bs÷–ÆöBæÆ–æ´FF¦7&VFTFVfVÇDÆ–æ´FF†6FVv÷&–W2“²V•&VfW&Væ6W3×–ÆöBçV•&VfW&Væ6W7ÇÆ7&VFTFVfVÇE&VfW&Væ6W2†6FVv÷&–W5³Ò“²G&—fT6öææV7F–öãÖæ÷&ÖÆ—¦TG&—fT6öææV7F–öâ‡–ÆöBæG&—fT6öææV7F–öâ“°¢6öç7B7FFSÖ&6·W7FFS²&6·W–æfó×–ÆöBæ&6·W–æf÷ÇÆ&6·W–æfó²&6·W7FFS×7FFS²Ö–w&FTFFf÷&ÖB‚“²v—B6fTFF–ä&6¶w&÷VæB‚“²v—BfÇW6„ÖVÖõ7–æ2‡·F‡&÷töäW'&÷#§G'VWÒ“²Ç•&VfW&Væ6W2‚“²6†÷t†öÖR‚“²&VæFW$&6·W6WGF–æw2‚“°§Ð§v–æF÷rç&WVW7D6Æ÷VD&6·WÖ7–æ2‚“Óç°¢–b†7W'&VçEW6W#òæ—4æöç–Ö÷W2’&WGW&â7W7FöÔÆW'B‚~«(ÎÈªNØ«‚«8NÊ	^ÉØ»ÉxR»ò»;^É¹ÉØBÉÛNÉªžÙZÈ‰‚ÉxnÈ«^¸¸Ž¸ºBâvöövÆR«8NÊ	^ÉØBÉ{¸ùžÙ[NÊ;ÎÈKŽÉ©Bâr“°¢–b†ÖçVÄ&6·W'WGFöãòæF—6&ÆVB’&WGW&ã°¢6öç7B÷&–v–æÂÒÖçVÄ&6·W'WGFöãòæ–ææW$…DÔÃ°¢–b†ÖçVÄ&6·W'WGFöâ’°¢ÖçVÄ&6·W'WGFöâæF—6&ÆVBÒG'VS°¢ÖçVÄ&6·W'WGFöâæ6Æ74Æ—7BæFB‚v÷6—G’ÓcrÂv7W'6÷"Öæ÷BÖÆÆ÷vVBr“°¢ÖçVÄ&6·W'WGFöâæ–ææW$…DÔÂÒsÆ’6Æ73Ò&f×6öÆ–Bf×7–ææW"f×7–â×"Ó"#ãÂö“îÉÛŽÊiÒ«Èº+~»ÉxRÊIs°¢Ð¢G'’°¢6öç7B&W7VÇBÒv—B'Vä&6·W‡²&V6öã¢vÖçVÂrÒ“°¢–b‡&W7VÇBç7FGW2ÓÓÒv7&VFVBr’°¢&VæFW$&6·W6WGF–æw2‚“°¢7W7FöÔÆW'B‚~ÙˆNÉêÂ¸ÛÉÛNØKÉÙ‚»Éx^«;Âf—&V&6R¸ùž«‹Ù™N«É˜Nº8Î¹	ŽÉxŽÈ«^¸¸Ž¸ºBâÊxÊBf—&V&6R¸ÛÉÛNØK¸øBÉXŽÊNÙYŽ«(Â»;N«H¹
ž¸¸Ž¸ºBâr“°¢ÒVÇ6R–b‡&W7VÇBç7FGW2ÓÓÒwVæ6†ævVBr’°¢&VæFW$&6·W6WGF–æw2‚“°¢7W7FöÔÆW'B‚~È8ŽºÞ«(Â»ÉxRÙZ¸+NÉªžÉÛBÉxnÈ«^¸¸Ž¸ºBâr“°¢Ð¢Ò6F6‚†W'&÷"’°¢7W7FöÔÆW'B†&6·WW'&÷$ÖW76vR†W'&÷"’“°¢Òf–æÆÇ’°¢–b†ÖçVÄ&6·W'WGFöâ’°¢ÖçVÄ&6·W'WGFöâæF—6&ÆVBÒfÇ6S°¢ÖçVÄ&6·W'WGFöâæ6Æ74Æ—7Bç&VÖ÷fR‚v÷6—G’ÓcrÂv7W'6÷"Öæ÷BÖÆÆ÷vVBr“°¢ÖçVÄ&6·W'WGFöâæ–ææW$…DÔÂÒ÷&–v–æÃ°¢Ð¢Ð§Ó°§v–æF÷ræF÷væÆöD6Æ÷VD&6·WÖ7–æ2&6·W–CÓç²G'’²6öç7BVçfVÆ÷SÖv—B&6·W6W'f–6RæÆöB‡·W6W#¦7W'&VçEW6W"Æ&6·W–GÒ“²6öç7B&Æö#ÖæWr&Æö"…´¥4ôâç7G&–æv–g’†VçfVÆ÷RÆçVÆÂÃ"•ÒÇ·G—S¢vÆ–6F–öâö§6öâwÒ“²6öç7BÆ–æ³ÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“²Æ–æ²æ‡&VcÕU$Âæ7&VFTö&¦V7EU$Â†&Æö"“²Æ–æ²æF÷væÆöCÖÆ–æ²ÖÖVÖòÖ&6·WÒG¶&6·W–GÒæ§6öæ²Æ–æ²æ6Æ–6²‚“²U$Âç&Wfö¶Tö&¦V7EU$Â†Æ–æ²æ‡&Vb“²Ò6F6‚†W'&÷"—¶7W7FöÔÆW'B†&6·WW'&÷$ÖW76vR†W'&÷"’“·ÒÓ°§v–æF÷rç&W7F÷&T6Æ÷VD&6·WÖ7–æ2&6·W–CÓç²G'’²6öç7BVçfVÆ÷SÖv—B&6·W6W'f–6RæÆöB‡·W6W#¦7W'&VçEW6W"Æ&6·W–GÒ“²6öç7BfÆ–FF–öã×fÆ–FFT–×÷'FVD&6·W†VçfVÆ÷RÆ7W'&VçEW6W"çV–B“²–b‚fÆ–FF–öâæö²—&WGW&â7W7FöÔÆW'B‡fÆ–FF–öâæW'&÷"“²7W7FöÔ6öæf—&Ò†G¶f÷&ÖD&6·WF–ÖR†VçfVÆ÷Ræ7&VFVDB—Ò»Éx^ÉËÎºÂÙˆNÉêÂ¸ÛÉÛNØKº[Â»;^É¹ÙYŽÈ¹Î«*È«^¸¸Ž«˜ÃöÆ7–æ2‚“Óç¶v—BÇ”&6·W–ÆöB‡fÆ–FF–öâçfÇVR“¶7W7FöÔÆW'B‚~»ÉxR¸ÛÉÛNØKº[Â»;^É¹ÙhŽÈ«^¸¸Ž¸ºBâr“·Ò“²Ö6F6‚†W'&÷"—¶7W7FöÔÆW'B†&6·WW'&÷$ÖW76vR†W'&÷"’“·ÒÓ°§v–æF÷ræ÷Vä&6·Wf–ÆU–6¶W#Ò‚“Óæ&6·Wf–ÆT–çWCòæ6Æ–6²‚“°¦&6·Wf–ÆT–çWCòæFDWfVçDÆ—7FVæW"‚v6†ævRrÆ7–æ2‚“Óç¶6öç7Bf–ÆSÖ&6·Wf–ÆT–çWBæf–ÆW3òå³Ó¶&6·Wf–ÆT–çWBçfÇVSÒrs¶–b‚f–ÆR—&WGW&ã·G'—¶6öç7BfÆ–FF–öã×fÆ–FFT–×÷'FVD&6·W„¥4ôâç'6R†v—Bf–ÆRçFW‡B‚’’Æ7W'&VçEW6W"çV–B“¶–b‚fÆ–FF–öâæö²—&WGW&â7W7FöÔÆW'B‡fÆ–FF–öâæW'&÷"“¶7W7FöÔ6öæf—&Ò‚~ÈJØ9ÞÙYÂ»ÉxRØÈÎÉÛÎºÂÙˆNÉêÂ¸ÛÉÛNØKº[Â»;^É¹ÙYŽÈ¹Î«*È«^¸¸Ž«˜ÃòrÆ7–æ2‚“Óç¶v—BÇ”&6·W–ÆöB‡fÆ–FF–öâçfÇVR“¶7W7FöÔÆW'B‚~»ÉxRØÈÎÉÛÎÉØB»;^É¹ÙhŽÈ«^¸¸Ž¸ºBâr“·Ò“·Ö6F6‡¶7W7FöÔÆW'B‚~»ÉxRØÈÎÉÛÎÉØBÉÛÞÉØBÈ‰‚ÉxnÈ«^¸¸Ž¸ºBâr“·×Ò“° ¦gVæ7F–öâ÷Vå6WGF–æw4ÖöFÂ‚’°¢—4&6·WÆ—7DW‡æFVBÒfÇ6S°¢Ç•&VfW&Væ6W2‚“°¢&VæFW$&6·W6WGF–æw2‚“°¢6WGF–æw4ÖöFÂæ6Æ74Æ—7Bç&VÖ÷fR‚v†–FFVâr“°§Ð ¦gVæ7F–öâ6Æ÷6U6WGF–æw4ÖöFÂ‚’°¢6WGF–æw4ÖöFÂæ6Æ74Æ—7BæFB‚v†–FFVâr“°§Ð§v–æF÷ræ÷Vå6WGF–æw4ÖöFÂÒ÷Vå6WGF–æw4ÖöFÃ°§v–æF÷ræ6Æ÷6U6WGF–æw4ÖöFÂÒ6Æ÷6U6WGF–æw4ÖöFÃ° §v–æF÷rç&WVW7D&W6WBÒ‚’Óâ°¢6Æ÷6U6WGF–æw4ÖöFÂ‚“°¢7W7FöÕ&ö×B‚~ºªŽ¹:Ø:ÒÂºxØÂÂÉÛNºûŽÊxÉ˜ÈJNÊ	^ÉØBËHŽ«‹Ù™NÙZž¸¸Ž¸ºBâ«8NÈhÞÙYŽº
Nº›B.ËHŽ«‹Ù™B.º[ÂÉè^º
^ÙYŽÈKŽÉ©BârÂrrÂ7–æ2fÇVRÓâ°¢–b‡fÇVRçG&–Ò‚’ÓÒ~ËHŽ«‹Ù™Br’&WGW&â7W7FöÔÆW'B‚~Ù™^ÉÛ‚ºËŽ«ZÎ«ÉÛÎË™ŽÙYŽÊxÉX®ÉXBËHŽ«‹Ù™NÙYŽÊxÉX®ÉYŽÈ«^¸¸Ž¸ºBâr“°¢G'’°¢v—BÖVÖõ6W'f–6Ræ6ÆV$–ÖvW2†7W'&VçEW6W#òçV–B“°¢6FVv÷&–W2Ò²ââäDTdTÅEô4DTtõ$”U5Ó°¢Æ–æ´FFÒ7&VFTFVfVÇDÆ–æ´FF†6FVv÷&–W2“°¢7F—fUF"Ò6FVv÷&–W5³Ó°¢V•&VfW&Væ6W2Ò7&VFTFVfVÇE&VfW&Væ6W2†7F—fUF"“°¢Ç•&VfW&Væ6W2‚“°¢v—B6fTFF‚“°¢6†÷t†öÖR‚“°¢7W7FöÔÆW'B‚~ÊNË+B¸ÛÉÛNØK«ËHŽ«‹Ù™N¹	ŽÉxŽÈ«^¸¸Ž¸ºBâr“°¢Ò6F6‚†W'&÷"’°¢7W7FöÔÆW'B‚~ËHŽ«‹Ù™BÊIÉŠNºYŽ«»	ÎÈ9ÞÙhŽÈ«^¸¸Ž¸ºBâr“°¢Ð¢Ò“°§Ó° ¦gVæ7F–öâvWE&VWF„ÖöFR‡W6W"’°¢–b‡W6W"æ—4æöç–Ö÷W2’&WGW&âvæöæRs°¢6öç7B&÷f–FW$–G2ÒW6W"ç&÷f–FW$FFæÖ‡&÷f–FW"Óâ&÷f–FW"ç&÷f–FW$–B“°¢–b‡&÷f–FW$–G2æ–æ6ÇVFW2‚vvöövÆRæ6öÒr’’&WGW&âvvöövÆRs°¢–b‡&÷f–FW$–G2æ–æ6ÇVFW2‚w77v÷&Br’’&WGW&âw77v÷&Bs°¢&WGW&âvæöæRs°§Ð §v–æF÷ræ÷Vä66÷VçDFVÆWFTÖöFÂÒ‚’Óâ°¢6Æ÷6U6WGF–æw4ÖöFÂ‚“°¢FVÆWFU&VWF„ÖöFRÒvWE&VWF„ÖöFR†7W'&VçEW6W"“°¢66÷VçDFVÆWFU‡&6RçfÇVRÒrs°¢66÷VçDFVÆWFU77v÷&BçfÇVRÒrs°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒFVÆWFU&VWF„ÖöFRÓÓÒvvöövÆRrò~«8NÈhÞÙYŽº›BvöövÆRÉêÎÉÛŽÊiÒËÞÉÛBÉ{NºkÞ¸¸Ž¸ºBâr¢rs°¢66÷VçDFVÆWFU77v÷&Ew&æ6Æ74Æ—7BçFövvÆR‚v†–FFVârÂFVÆWFU&VWF„ÖöFRÓÒw77v÷&Br“°¢66÷VçDFVÆWFT6öæf—&Ô'FâæF—6&ÆVBÒfÇ6S°¢66÷VçDFVÆWFT6öæf—&Ô'Fâæ6Æ74Æ—7Bç&VÖ÷fR‚v÷6—G’ÓcrÂv7W'6÷"Öæ÷BÖÆÆ÷vVBr“°¢66÷VçDFVÆWFTÖöFÂæ6Æ74Æ—7Bç&VÖ÷fR‚v†–FFVâr“°¢66÷VçDFVÆWFU‡&6Ræfö7W2‚“°§Ó° ¦gVæ7F–öâ6Æ÷6T66÷VçDFVÆWFTÖöFÂ‚’°¢–b†—4FVÆWF–æt66÷VçB’&WGW&ã°¢66÷VçDFVÆWFTÖöFÂæ6Æ74Æ—7BæFB‚v†–FFVâr“°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒrs°§Ð§v–æF÷ræ6Æ÷6T66÷VçDFVÆWFTÖöFÂÒ6Æ÷6T66÷VçDFVÆWFTÖöFÃ° §v–æF÷ræ6öæf—&Ô66÷VçDFVÆWF–öâÒ7–æ2‚’Óâ°¢6öç7BW6W"ÒWFƒòæ7W'&VçEW6W#°¢–b‚W6W"ÇÂ—4FVÆWF–æt66÷VçB’&WGW&ã°¢–b†66÷VçDFVÆWFU‡&6RçfÇVRçG&–Ò‚’ÓÒ~Ù¨ÎÉ¹Ø8ŽØ{Br’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~Ù™^ÉÛ‚ºËŽ«ZÎ«ÉÛÎË™ŽÙYŽÊxÉX®È«^¸¸Ž¸ºBâs°¢&WGW&ã°¢Ð¢–b†FVÆWFU&VWF„ÖöFRÓÓÒw77v÷&Brbb66÷VçDFVÆWFU77v÷&BçfÇVR’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~ÙˆNÉêÂ»˜N»»(ŽÙ‹Žº[ÂÉè^º
^Ù[NÊ;ÎÈKŽÉ©Bâs°¢&WGW&ã°¢Ð ¢66÷VçDFVÆWFT6öæf—&Ô'FâæF—6&ÆVBÒG'VS°¢66÷VçDFVÆWFT6öæf—&Ô'Fâæ6Æ74Æ—7BæFB‚v÷6—G’ÓcrÂv7W'6÷"Öæ÷BÖÆÆ÷vVBr“°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~»;ŽÉÛ‚Ù™^ÉÛ‚ÊIÉè^¸¸Ž¸ºBâs°¢ÆWBFFFVÆWFVBÒfÇ6S°¢G'’°¢–b†FVÆWFU&VWF„ÖöFRÓÓÒvvöövÆRr’°¢v—B&VWF†VçF–6FUv—F…÷W‡W6W"ÂæWrvöövÆTWF…&÷f–FW"‚’“°¢ÒVÇ6R–b†FVÆWFU&VWF„ÖöFRÓÓÒw77v÷&Br’°¢v—B&VWF†VçF–6FUv—F„7&VFVçF–Â‡W6W"ÂVÖ–ÄWF…&÷f–FW"æ7&VFVçF–Â‡W6W"æVÖ–ÂÂ66÷VçDFVÆWFU77v÷&BçfÇVR’“°¢Ð ¢—4FVÆWF–æt66÷VçBÒG'VS°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~«8NÊ	^«;Â¸ÛÉÛNØKº[ÂÈ*ÞÊ	ÎÙYŽ¸©BÊIÉè^¸¸Ž¸ºBâs°¢–b‡Vç7V'67&–&U6æ6†÷B’Vç7V'67&–&U6æ6†÷B‚“°¢Vç7V'67&–&U6æ6†÷BÒçVÆÃ°¢v—BÖVÖõ&W÷6—F÷'’æFVÆWFR‡W6W"çV–BÂ²&6†—fT–G3¢vWD&6·WÆ—7B†&6·W7FFR’æÖ†&6·WÓâ&6·Wæ–B’Ò“°¢FFFVÆWFVBÒG'VS°¢v—BÖVÖõ6W'f–6Ræ6ÆV$–ÖvW2‡W6W"çV–B“°¢v—BÆö6ÄÖVÖõ&W÷6—F÷'’æ6ÆV"‡W6W"çV–B“°¢v—BFVÆWFUW6W"‡W6W"“°¢—4FVÆWF–æt66÷VçBÒfÇ6S°¢66÷VçDFVÆWFTÖöFÂæ6Æ74Æ—7BæFB‚v†–FFVâr“°¢Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bç&VÖ÷fR‚wF†VÖRÖF&²r“°¢6†÷tÆöv–â‚“°¢Ò6F6‚†W'&÷"’°¢—4FVÆWF–æt66÷VçBÒfÇ6S°¢66÷VçDFVÆWFT6öæf—&Ô'FâæF—6&ÆVBÒfÇ6S°¢66÷VçDFVÆWFT6öæf—&Ô'Fâæ6Æ74Æ—7Bç&VÖ÷fR‚v÷6—G’ÓcrÂv7W'6÷"Öæ÷BÖÆÆ÷vVBr“°¢–b†W'&÷"æ6öFRÓÓÒvWF‚÷w&öær×77v÷&BrÇÂW'&÷"æ6öFRÓÓÒvWF‚ö–çfÆ–BÖ7&VFVçF–Âr’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~»˜N»»(ŽÙ‹Ž«ÉŠÎ»	Nº[NÊxÉX®È«^¸¸Ž¸ºBâs°¢ÒVÇ6R–b†W'&÷"æ6öFRÓÓÒvWF‚÷÷WÖ6Æ÷6VBÖ'’×W6W"r’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒtvöövÆRÉêÎÉÛŽÊiÞÉÛBËzŽÈhÎ¹	ŽÉxŽÈ«^¸¸Ž¸ºBâs°¢ÒVÇ6R–b†W'&÷"æ6öFRÓÓÒvWF‚÷&WV—&W2×&V6VçBÖÆöv–âr’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~¸ºNÈ¹ÂºÎ«{ŽÉÛŽÙYÂ¹*BÙ¨ÎÉ¹Ø8ŽØ{Nº[ÂÈ¹Î¸øNÙ[NÊ;ÎÈKŽÉ©Bâs°¢ÒVÇ6R–b†FFFVÆWFVB’°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~¸ÛÉÛNØK¸©BÈ*ÞÊ	Î¹	ÊxºxÂ«8NÊ	RÈ*ÞÊ	Î«É˜Nº8Î¹	ŽÊxÉX®ÉYŽÈ«^¸¸Ž¸ºBâ¸ºNÈ¹ÂÈ¹Î¸øNÙ[NÊ;ÎÈKŽÉ©Bâs°¢ÒVÇ6R°¢66÷VçDFVÆWFU7FGW2çFW‡D6öçFVçBÒ~Ù¨ÎÉ¹Ø8ŽØ{BË)ŽºjÎÉyÈºNØÊŽÙhŽÈ«^¸¸Ž¸ºBâ¸ºNÈ¹ÂÈ¹Î¸øNÙ[NÊ;ÎÈKŽÉ©Bâs°¢Ð¢–b‚FFFVÆWFVBbb7W'&VçEW6W"bbVç7V'67&–&U6æ6†÷B’ÆöDFFg&öÔf—&W7F÷&R‚“°¢Ð§Ó° ¦F&´ÖöFUFövvÆRæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ2WfVçBÓâ°¢V•&VfW&Væ6W2æF&´ÖöFRÒWfVçBçF&vWBæ6†V6¶VC°¢Ç•&VfW&Væ6W2‚“°¢v—B6fU&VfW&Væ6W2‚“°§Ò“° ¦Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚v–çWE¶æÖSÒ&föÆFW$6öÇVÖç2%Òr’æf÷$V6‚†–çWBÓâ°¢–çWBæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ2WfVçBÓâ°¢6öç7B6öÇVÖç2ÒçVÖ&W"†WfVçBçF&vWBçfÇVR“°¢–b‚dÄ”Eô4ôÅTÔå2æ–æ6ÇVFW2†6öÇVÖç2’’&WGW&ã°¢V•&VfW&Væ6W2æföÆFW$6öÇVÖç2Ò6öÇVÖç3°¢Ç•&VfW&Væ6W2‚“°¢&VæFW$†öÖTÆæF–ær‚“°¢v—B6fU&VfW&Væ6W2‚“°¢Ò“°§Ò“° ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ°¢–b‚WfVçBçF&vWBæ6Æ÷6W7B‚rçF"ÖÖVçRÖ'WGFöâr’bbWfVçBçF&vWBæ6Æ÷6W7B‚rçF"ÖÖVçR×æVÂr’’°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rçF"ÖÖVçR×æVÂr’æf÷$V6‚‡æVÂÓâæVÂæ6Æ74Æ—7BæFB‚v†–FFVâr’“°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rçF"ÖÖVçRÖ'WGFöâr’æf÷$V6‚†'WGFöâÓâ'WGFöâç6WDGG&–'WFR‚v&–ÖW‡æFVBrÂvfÇ6Rr’“°¢Ð§Ò“° ¦–ÖvU&Wf–WtÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ²–b†WfVçBçF&vWBÓÓÒ–ÖvU&Wf–WtÖöFÂ’†–FT–ÖvU&Wf–Wr‚“²Ò“°§6WGF–æw4ÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ²–b†WfVçBçF&vWBÓÓÒ6WGF–æw4ÖöFÂ’6Æ÷6U6WGF–æw4ÖöFÂ‚“²Ò“°¦66÷VçDFVÆWFTÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ²–b†WfVçBçF&vWBÓÓÒ66÷VçDFVÆWFTÖöFÂ’6Æ÷6T66÷VçDFVÆWFTÖöFÂ‚“²Ò“°¦Æ–æ´VF—DÖöFÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂWfVçBÓâ²–b†WfVçBçF&vWBÓÓÒÆ–æ´VF—DÖöFÂ’v–æF÷ræ6Æ÷6TÆ–æ´VF—DÖöFÂ‚“²Ò“°  ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂWfVçBÓâ°¢–b‚–ÖvU&Wf–WtÖöFÂæ6Æ74Æ—7Bæ6öçF–ç2‚v†–FFVâr’bbWfVçBæ¶W’ÓÓÒt'&÷tÆVgBr’°¢WfVçBç&WfVçDFVfVÇB‚“°¢Ö÷fT6&÷W6VÂ‚Ó“°¢&WGW&ã°¢Ð¢–b‚–ÖvU&Wf–WtÖöFÂæ6Æ74Æ—7Bæ6öçF–ç2‚v†–FFVâr’bbWfVçBæ¶W’ÓÓÒt'&÷u&–v‡Br’°¢WfVçBç&WfVçDFVfVÇB‚“°¢Ö÷fT6&÷W6VÂƒ“°¢&WGW&ã°¢Ð¢–b†WfVçBæ¶W’ÓÒtW66Rr’&WGW&ã°¢7F—fUF$7F–öä6öçG&öÆÆW#òæ6æ6VÂ‚“°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rçF"ÖÖVçR×æVÂr’æf÷$V6‚‡æVÂÓâæVÂæ6Æ74Æ—7BæFB‚v†–FFVâr’“°¢†–FT–ÖvU&Wf–Wr‚“°¢6Æ÷6U6WGF–æw4ÖöFÂ‚“°¢6Æ÷6T66÷VçDFVÆWFTÖöFÂ‚“°¢v–æF÷ræ6Æ÷6TÆ–æ´VF—DÖöFÂ‚“°¢v–æF÷ræ6Æ÷6TÆ–æ´66÷VçDÖöFÂ‚“°§Ò“°