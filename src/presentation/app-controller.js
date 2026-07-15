import {
    signInWithCustomToken, signInAnonymously, onAuthStateChanged, onIdTokenChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    GoogleAuthProvider, signInWithPopup, EmailAuthProvider, linkWithCredential,
    linkWithPopup, reauthenticateWithCredential, reauthenticateWithPopup,
    deleteUser, auth, hasFirebaseConfig
} from "../infrastructure/firebase/auth-gateway.js";
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";
import { createMemoService } from "../application/memos/memo-service.js";
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
import { createBackupState, addBackupSuccess, addBackupFailure, validateImportedBackup } from "../domain/backups/backup-policy.js";
import { createFirebaseTokenProvider } from "../infrastructure/firebase/auth-token-provider.js";
import { getLatestKstBackupSlot, getNextKstBackupSlot, getKstSlotKey } from "../domain/backups/backup-schedule-policy.js";

const memoRepository = createFirestoreMemoRepository();
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
const imageAttachmentQueue = createImageAttachmentQueue({
    saveLocalImage: file => saveImageFile(file),
    uploadDriveImage: file => saveDriveImage(file),
    createAttachmentId: () => createId('image'),
    canUploadToDrive: () => canUseDrive(driveConnection),
    concurrency: 2
});

const DEFAULT_CATEGORIES = ['업무', '학습', '개인', '도구', '기타'];
const DEFAULT_COLUMNS = 3;
const VALID_COLUMNS = [3, 4, 5, 6];
const BACKUP_LEASE_KEY = 'link-memo:auto-backup-lease';
const BACKUP_LEASE_MS = 10 * 60 * 1000;

const { customAlert, customConfirm, customPrompt } = createModalController();
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.customPrompt = customPrompt;
const loginScreen = document.getElementById('loginScreen');
const homeLanding = document.getElementById('homeLanding');
const mainApp = document.getElementById('mainApp');
const homeUserInfoDisplay = document.getElementById('homeUserInfoDisplay');
const userInfoDisplay = document.getElementById('userInfoDisplay');
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
let guestBackupNoticeShown = false;
let backupTimer = null;
let backupAuthReady = false;
let backupSessionStartedAt = null;
let nextAutomaticBackupAt = null;
const backupTabId = crypto.randomUUID?.() || `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let lastStableMemoData = null;
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
function startAutomaticBackupTimer() {
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = null;
    if (!currentUser || currentUser.isAnonymous || !backupAuthReady) return;
    nextAutomaticBackupAt = getNextKstBackupSlot(Date.now());
    const delay = Math.max(0, nextAutomaticBackupAt - Date.now());
    backupTimer = setTimeout(() => { void runScheduledBackup(nextAutomaticBackupAt); }, delay);
    renderBackupSettings();
}
async function runScheduledBackup(scheduledFor) {
    if (!currentUser || currentUser.isAnonymous || isDeletingAccount || dataLoadState !== 'ready') return startAutomaticBackupTimer();
    if (backupSessionStartedAt && scheduledFor < backupSessionStartedAt) return startAutomaticBackupTimer();
    if (Number(backupState.auto?.lastScheduledFor || 0) >= scheduledFor) return startAutomaticBackupTimer();
    if (!acquireAutomaticBackupLease(scheduledFor)) return startAutomaticBackupTimer();
    let succeeded = false;
    try {
        succeeded = await saveData({ forceBackup: true, reason: 'auto', scheduledFor });
    } finally {
        releaseAutomaticBackupLease(scheduledFor, succeeded);
        startAutomaticBackupTimer();
    }
}
async function refreshBackupAuthentication({ forceRefresh = false } = {}) {
    if (!currentUser || currentUser.isAnonymous) {
        backupAuthReady = false;
        return false;
    }
    try {
        await backupTokenProvider.getToken({ forceRefresh });
        backupAuthReady = true;
        startAutomaticBackupTimer();
        renderBackupSettings();
        return true;
    } catch (error) {
        backupAuthReady = false;
        renderBackupSettings();
        console.warn('백업 인증 자동 갱신 대기 중', error);
        return false;
    }
}
async function resumeAutomaticBackup() {
    const ready = await refreshBackupAuthentication();
    if (!ready || !backupSessionStartedAt) return;
    const latestSlot = getLatestKstBackupSlot(Date.now());
    if (latestSlot >= backupSessionStartedAt && Number(backupState.auto?.lastScheduledFor || 0) < latestSlot) {
        await runScheduledBackup(latestSlot);
    } else {
        startAutomaticBackupTimer();
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resumeAutomaticBackup();
});
window.addEventListener('online', () => { void resumeAutomaticBackup(); });

function createDefaultPreferences(lastViewedTab = DEFAULT_CATEGORIES[0]) {
    return { darkMode: false, folderColumns: DEFAULT_COLUMNS, lastViewedTab };
}

function createDefaultLinkData(categoryList = DEFAULT_CATEGORIES) {
    return Object.fromEntries(categoryList.map(category => [category, [{ id: createId('sub'), title: '기본 분류', isOpen: true, links: [] }]]));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
}

if (!hasFirebaseConfig) {
    loginScreen.classList.remove('hidden');
    loginScreen.classList.add('flex');
    setTimeout(() => customAlert('Firebase 설정이 누락되었습니다. GitHub Actions Secrets와 Pages 배포 설정을 확인해주세요.'), 500);
}

function normalizePreferences(value = {}) {
    const folderColumns = VALID_COLUMNS.includes(Number(value.folderColumns)) ? Number(value.folderColumns) : DEFAULT_COLUMNS;
    const lastViewedTab = categories.includes(value.lastViewedTab) ? value.lastViewedTab : (categories[0] || '');
    return { darkMode: value.darkMode === true, folderColumns, lastViewedTab };
}

function applyPreferences() {
    document.body.classList.toggle('theme-dark', uiPreferences.darkMode === true);
    if (categoryFolderGrid) categoryFolderGrid.dataset.columns = String(uiPreferences.folderColumns);
    if (darkModeToggle) darkModeToggle.checked = uiPreferences.darkMode === true;
    document.querySelectorAll('input[name="folderColumns"]').forEach(input => {
        input.checked = Number(input.value) === uiPreferences.folderColumns;
    });
}

function buildMemoPayload() {
    return { categories, linkData, uiPreferences, driveConnection, backupInfo, backupState };
}

function cloneMemoPayload(value) {
    return JSON.parse(JSON.stringify(value));
}

async function savePreferences() {
    return saveData();
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    loginScreen.classList.add('flex');
    homeLanding.classList.add('hidden');
    mainApp.classList.add('hidden');
}

function showHome() {
    loginScreen.classList.add('hidden');
    loginScreen.classList.remove('flex');
    homeLanding.classList.remove('hidden');
    mainApp.classList.add('hidden');
    applyPreferences();
    renderHomeLanding();
}

function showMain(category = uiPreferences.lastViewedTab || activeTab) {
    const target = categories.includes(category) ? category : categories[0];
    if (!target) return;
    activeTab = target;
    uiPreferences.lastViewedTab = target;
    loginScreen.classList.add('hidden');
    loginScreen.classList.remove('flex');
    homeLanding.classList.add('hidden');
    mainApp.classList.remove('hidden');
    applyPreferences();
    initApp();
    savePreferences();
}

window.showHome = showHome;
window.showMain = showMain;

function updateHeaderUI(user) {
    const isGuest = user.isAnonymous || !user.email;
    const identifier = isGuest ? '게스트 사용자' : user.email;
    const linkButton = isGuest
        ? '<button onclick="window.openLinkAccountModal()" class="text-xs bg-green-100 text-green-700 hover:bg-green-600 hover:text-white px-3 py-1.5 rounded font-semibold shadow-sm mr-2 border border-green-200"><i class="fa-solid fa-link mr-1"></i>계정 연동</button>'
        : '';
    const content = `<i class="fa-solid fa-user-circle text-blue-500 mr-2 text-lg"></i><span class="mr-3 text-gray-700 font-bold truncate max-w-[11rem]">${escapeHtml(identifier)}</span>${linkButton}<button onclick="window.handleLogout()" class="text-xs bg-red-100 text-red-600 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded font-semibold shadow-sm border border-red-200">로그아웃</button>`;
    userInfoDisplay.innerHTML = content;
    homeUserInfoDisplay.innerHTML = content;
}

function createFolderButton(label, icon, color, onClick, subtitle = '열기') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-button bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md rounded-lg p-5 text-left transition-colors flex flex-col justify-between';
    button.innerHTML = `<span class="folder-icon-shell rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center mb-4"><i class="fa-solid ${icon} ${color} text-4xl"></i></span><span class="folder-title text-lg font-bold text-gray-800 truncate w-full">${escapeHtml(label)}</span><span class="folder-subtitle text-sm text-gray-500 mt-1 truncate w-full">${escapeHtml(subtitle)}</span>`;
    button.onclick = onClick;
    return button;
}

function getHomeRenderSignature(recentTab) {
    return JSON.stringify({
        userId: currentUser?.uid || '',
        recentTab,
        folderColumns: uiPreferences.folderColumns,
        categories: categories.map(category => ({
            name: category,
            count: (linkData[category] || []).reduce((sum, subcategory) => sum + (subcategory.links?.length || 0), 0)
        }))
    });
}

function renderHomeLanding() {
    const fixedFolderGrid = document.getElementById('fixedFolderGrid');
    if (!fixedFolderGrid || !categoryFolderGrid) return;
    const recentTab = categories.includes(uiPreferences.lastViewedTab) ? uiPreferences.lastViewedTab : (categories[0] || '');
    uiPreferences.lastViewedTab = recentTab;
    const renderSignature = getHomeRenderSignature(recentTab);

    // Firestore의 로컬/서버 스냅샷이 같은 내용으로 연속 도착해도
    // 사용자가 누르고 있거나 hover 중인 실제 버튼 노드를 교체하지 않습니다.
    if (
        homeRenderSignature === renderSignature
        && fixedFolderGrid.childElementCount === 3
        && categoryFolderGrid.childElementCount === categories.length
    ) {
        categoryFolderGrid.dataset.columns = String(uiPreferences.folderColumns);
        return;
    }

    fixedFolderGrid.innerHTML = '';
    fixedFolderGrid.append(
        createFolderButton('최근', 'fa-clock-rotate-left', 'text-indigo-500', () => showMain(recentTab), recentTab || '탭 없음'),
        createFolderButton('새 탭 생성', 'fa-folder-plus', 'text-emerald-500', () => window.addMainCategory(), '탭 추가'),
        createFolderButton('설정', 'fa-gear', 'text-gray-500', () => window.openSettingsModal(), '환경 설정')
    );

    categoryFolderGrid.innerHTML = '';
    categoryFolderGrid.dataset.columns = String(uiPreferences.folderColumns);
    categories.forEach(category => {
        const count = (linkData[category] || []).reduce((sum, subcategory) => sum + (subcategory.links?.length || 0), 0);
        categoryFolderGrid.appendChild(createFolderButton(category, 'fa-folder', 'text-amber-500', () => showMain(category), `${count}개 항목`));
    });
    homeRenderSignature = renderSignature;
}

if (auth) {
    onIdTokenChanged(auth, user => {
        if (user && currentUser?.uid === user.uid) {
            currentUser = user;
            backupTokenProvider.updateUser(user);
            if (!backupAuthReady) void refreshBackupAuthentication();
        }
    });
    onAuthStateChanged(auth, user => {
        if (user) {
            currentUser = user;
            backupTokenProvider.updateUser(user);
            backupAuthReady = false;
            backupSessionStartedAt = Date.now();
            updateHeaderUI(user);
            void refreshBackupAuthentication();
            if (user.isAnonymous && !guestBackupNoticeShown) {
                guestBackupNoticeShown = true;
                setTimeout(() => customAlert('게스트 계정은 백업 및 복구의 이용이 불가합니다. 더 원활한 데이터 관리를 원하실 경우 구글 계정 연동을 진행해주세요.'), 350);
            }
            loadDataFromFirestore();
            return;
        }
        currentUser = null;
        homeRenderSignature = null;
        backupTokenProvider.updateUser(null);
        backupAuthReady = false;
        backupSessionStartedAt = null;
        if (backupTimer) clearInterval(backupTimer);
        backupTimer = null;
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        unsubscribeSnapshot = null;
        categories = [...DEFAULT_CATEGORIES];
        activeTab = categories[0];
        linkData = {};
        uiPreferences = createDefaultPreferences(activeTab);
        driveConnection = createDefaultDriveConnection();
        dataLoadState = 'loading';
        memoRevision = null;
        backupInfo = null;
        backupState = createBackupState();
        guestBackupNoticeShown = false;
        lastStableMemoData = null;
        dataSafetyAlertShown = false;
        drivePromptRequested = false;
        driveImageRepository.clearCache();
        document.body.classList.remove('theme-dark');
        isFirstLoad = true;
        closeSettingsModal();
        closeAccountDeleteModal();
        showLogin();
    });
}

window.handleEmailLogin = async () => {
    if (!auth) return;
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        customAlert('로그인 실패: 이메일 또는 비밀번호를 확인해주세요.');
    }
};

window.handleEmailRegister = async () => {
    if (!auth) return;
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        customAlert('회원가입이 완료되었습니다.');
    } catch (error) {
        customAlert('회원가입에 실패했습니다. 이메일과 비밀번호 조건을 확인해주세요.');
    }
};

window.handleGoogleLogin = async () => {
    if (!auth) return;
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') customAlert('Google 로그인에 실패했습니다. 승인된 도메인과 로그인 제공업체 설정을 확인해주세요.');
    }
};


// Presentation controller: Google 계정의 Drive 권한 상태는 Firestore에만 기록하고 토큰은 저장하지 않습니다.
function isGoogleAccount(user = currentUser) {
    return Boolean(user?.providerData?.some(provider => provider.providerId === 'google.com'));
}

function describeDriveError(error) {
    const messages = {
        DRIVE_OAUTH_CLIENT_ID_MISSING: 'Google Drive 연결 설정이 아직 완료되지 않았습니다. 배포 환경의 OAuth Client ID를 확인해주세요.',
        DRIVE_WORKER_URL_MISSING: 'Google Drive 보안 연결 주소가 설정되지 않았습니다.',
        DRIVE_ACCOUNT_MISMATCH: 'Drive 권한은 현재 링크 메모에 로그인한 Google 계정으로만 연결할 수 있습니다.',
        DRIVE_OFFLINE_ACCESS_REQUIRED: 'Google에서 장기 Drive 연결 정보를 받지 못했습니다. 설정에서 Drive 연결 해제를 누른 뒤 다시 연결해주세요.',
        DRIVE_REAUTH_REQUIRED: '기존 Google Drive 권한을 사이트에서 초기화했습니다. Drive 연결 버튼을 한 번 더 눌러 새 권한을 승인해주세요.',
        GOOGLE_TOKEN_EXCHANGE_FAILED: 'Google 권한 코드를 교환하지 못했습니다. OAuth Client ID와 Secret 설정을 확인해주세요.',
        TOKEN_ENCRYPTION_KEY_INVALID: 'Drive 보안 저장소 암호화 설정이 올바르지 않습니다.',
        DRIVE_NOT_CONNECTED: 'Drive 연결 정보가 없습니다. Drive 연결을 다시 시도해주세요.',
        DRIVE_TOKEN_REFRESH_FAILED: 'Drive 연결이 만료되었습니다. Drive 연결을 다시 시도해주세요.',
        TOKEN_ENCRYPTION_KEY_INVALID: 'Cloudflare 암호화 키 설정 오류입니다. Worker의 TOKEN_ENCRYPTION_KEY Secret에 32자 이상 임의의 비밀 문구를 입력해주세요.',
        DRIVE_CREDENTIALS_CORRUPTED: '저장된 Drive 연결 정보가 손상되었습니다. 설정에서 Drive 연결 해제를 누른 뒤 다시 연결해주세요.',
        DRIVE_CREDENTIALS_RECOVERY_REQUIRED: '기존 Drive 연결 정보를 읽을 수 없습니다. 설정에서 Drive 연결 해제를 누른 뒤 다시 연결해주세요.',
        DRIVE_NOT_CONNECTED: 'Drive 연결이 저장되지 않았습니다. 설정에서 Drive 연결을 다시 완료해주세요.'
    };
    if (messages[error?.message]) return messages[error.message];
    if (error?.code === 'popup_closed_by_user' || error?.message === 'popup_closed_by_user' || error?.message === 'popup_closed') {
        return 'Google Drive 권한 승인이 취소되었습니다.';
    }
    if (error?.message === 'popup_failed_to_open') {
        return 'Google 권한 창을 열지 못했습니다. 브라우저의 팝업 차단을 해제해주세요.';
    }
    if (error?.message === 'unknown') {
        return 'Google 권한 창에서 오류가 발생했습니다. OAuth Client ID, 허용된 JavaScript 원본, 테스트 사용자 설정을 확인해주세요.';
    }
    return 'Google Drive 연결에 실패했습니다. 잠시 후 다시 시도해주세요.';
}

function setDriveSyncStatus(message = '') {
    if (driveSyncStatus) driveSyncStatus.textContent = message;
}

function describeDriveSync(result) {
    const uploaded = result.uploaded + result.repaired;
    const details = [];
    if (result.available) details.push(`정상 ${result.available}개`);
    if (result.uploaded) details.push(`신규 업로드 ${result.uploaded}개`);
    if (result.repaired) details.push(`복구 업로드 ${result.repaired}개`);
    if (result.unrecoverable) details.push(`원본 없음 ${result.unrecoverable}개`);
    if (result.failed) details.push(`실패 ${result.failed}개`);
    return {
        summary: details.join(', ') || '첨부 이미지가 없습니다.',
        hasUpload: uploaded > 0
    };
}

async function syncDriveImages({ announce = true } = {}) {
    if (!canUseDrive(driveConnection)) {
        customAlert('먼저 Google Drive를 연결해주세요.');
        return null;
    }
    if (driveRepairButton) {
        driveRepairButton.disabled = true;
        driveRepairButton.classList.add('opacity-60', 'cursor-not-allowed');
    }
    setDriveSyncStatus('Drive 이미지 상태를 점검하는 중입니다.');
    try {
        const result = await driveImageService.repairDriveImages(linkData, driveConnection, {
            onProgress: ({ completed, total }) => setDriveSyncStatus(`Drive 이미지 점검 및 복구 중: ${completed}/${total}`)
        });
        if (result.error) throw result.error;
        driveConnection = result.connection;
        await saveData();
        const description = describeDriveSync(result);
        setDriveSyncStatus(description.summary);
        if (announce) {
            const warning = result.unrecoverable
                ? ` 원본이 현재 PC 브라우저에 없는 ${result.unrecoverable}개 이미지는 다시 첨부해야 합니다.`
                : '';
            customAlert(`Drive 이미지 동기화 완료: ${description.summary}.${warning}`);
        }
        return result;
    } catch (error) {
        console.error('Drive 이미지 동기화 실패:', error);
        setDriveSyncStatus('Drive 이미지 동기화에 실패했습니다.');
        if (announce) customAlert(describeDriveError(error));
        return null;
    } finally {
        if (driveRepairButton) {
            driveRepairButton.disabled = false;
            driveRepairButton.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    }
}

async function connectGoogleDrive({ migrate = true } = {}) {
    if (!isGoogleAccount()) {
        customAlert('Google Drive 이미지는 Google 계정으로 로그인한 사용자만 연결할 수 있습니다.');
        return false;
    }
    try {
        driveConnection = await driveImageService.connect(driveConnection, { loginHint: currentUser.email || '' });
        await saveData();
        if (migrate) await syncDriveImages({ announce: true });
        else customAlert('Google Drive 연결이 완료되었습니다.');
        return true;
    } catch (error) {
        console.error('Google Drive 연결 실패:', error);
        customAlert(describeDriveError(error));
        return false;
    }
}

async function requestInitialDrivePermission() {
    if (!isGoogleAccount() || drivePromptRequested || driveConnection.permissionGranted !== null) return;
    drivePromptRequested = true;
    // 취소를 포함한 최초 선택을 false로 기록해 같은 계정에 자동 모달을 반복하지 않습니다.
    driveConnection = { ...driveConnection, permissionGranted: false, promptedAt: Date.now() };
    await saveData();
    customConfirm(
        '이미지를 다른 기기에서도 안전하게 보려면 Google Drive 연결을 허용해주세요. 개인 Drive 이미지는 공개 링크로 만들지 않으며, 허용한 계정만 접근할 수 있습니다.',
        async () => { await connectGoogleDrive({ migrate: true }); }
    );
}

window.connectGoogleDrive = () => connectGoogleDrive({ migrate: true });
window.repairDriveImages = () => syncDriveImages({ announce: true });
window.disconnectGoogleDrive = () => {
    if (!currentUser) return;
    customConfirm(
        '이 기기의 Drive 연결 정보와 Google Drive 권한을 해제합니다. Drive에 이미 저장된 이미지 파일은 삭제하지 않습니다. 계속하시겠습니까?',
        async () => {
            try {
                await driveImageRepository.disconnect();
                driveConnection = {
                    ...createDefaultDriveConnection(),
                    permissionGranted: false,
                    promptedAt: Date.now()
                };
                await saveData();
                driveImageRepository.clearCache();
                setDriveSyncStatus('Drive 연결과 Google Drive 권한을 해제했습니다. 다시 연결하면 새 권한으로 안전하게 저장됩니다.');
                customAlert('Google Drive 연결과 권한을 해제했습니다. 필요할 때 Drive 연결 버튼으로 다시 승인해주세요.');
            } catch (error) {
                console.error('Google Drive 연결 해제 실패:', error);
                customAlert(describeDriveError(error));
            }
        }
    );
};

function warnLocalOnlyImageStorage() {
    if (canUseDrive(driveConnection)) return;
    customAlert('본 사이트의 이미지 업로드는 외부 서버에 업로드 되지 않음으로 현재 브라우저/기기에서만 볼 수 있습니다. 다른 기기에서도 볼 수 있기를 원하신다면 구글 계정 연동 및 드라이브 연결을 허용해주세요.');
}

async function saveDriveImage(file) {
    if (!canUseDrive(driveConnection)) return null;
    const result = await driveImageService.upload(file, driveConnection);
    driveConnection = result.connection;
    return result.driveImage;
}

window.handleGuestLogin = async () => {
    if (!auth) return;
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            try {
                await signInWithCustomToken(auth, __initial_auth_token);
                return;
            } catch (error) {
                console.warn('커스텀 토큰 로그인에 실패해 익명 로그인을 시도합니다.');
            }
        }
        await signInAnonymously(auth);
    } catch (error) {
        customAlert('게스트 로그인에 실패했습니다. Firebase 익명 로그인이 활성화되어 있는지 확인해주세요.');
    }
};

window.handleLogout = () => {
    if (!auth) return;
    customConfirm('로그아웃 하시겠습니까?', async () => {
        await signOut(auth);
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
    });
};

window.openLinkAccountModal = () => {
    document.getElementById('linkEmailInput').value = '';
    document.getElementById('linkPasswordInput').value = '';
    document.getElementById('linkAccountModal').classList.remove('hidden');
};
window.closeLinkAccountModal = () => document.getElementById('linkAccountModal').classList.add('hidden');

window.handleEmailLink = async () => {
    if (!auth?.currentUser) return;
    const email = document.getElementById('linkEmailInput').value.trim();
    const password = document.getElementById('linkPasswordInput').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try {
        const credential = EmailAuthProvider.credential(email, password);
        const result = await linkWithCredential(auth.currentUser, credential);
        updateHeaderUI(result.user);
        window.closeLinkAccountModal();
        customAlert('계정이 성공적으로 연동되었습니다.');
    } catch (error) {
        customAlert('계정 연동에 실패했습니다. 이미 사용 중인 이메일인지 확인해주세요.');
    }
};

window.handleGoogleLink = async () => {
    if (!auth?.currentUser) return;
    try {
        const result = await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
        updateHeaderUI(result.user);
        window.closeLinkAccountModal();
        customAlert('Google 계정이 성공적으로 연동되었습니다.');
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') customAlert('Google 계정 연동에 실패했습니다.');
    }
};

async function saveImageFile(file, oldImageId = null) {
    return memoService.saveImage(file, {
        id: createId('img'),
        userId: currentUser?.uid || 'guest',
        oldImageId
    });
}

function resetSelectedImage() {
    selectedImageFiles = [];
    imageInput.value = '';
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    imagePreview.classList.add('hidden');
    imagePreviewName.textContent = '';
}

imageInput.addEventListener('change', () => {
    const validation = validateImageSelection(imageInput.files);
    if (!validation.ok) {
        customAlert(validation.error);
        return resetSelectedImage();
    }
    selectedImageFiles = validation.value;
    if (!selectedImageFiles.length) return resetSelectedImage();
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(selectedImageFiles[0]);
    imagePreviewName.textContent = selectedImageFiles.length === 1
        ? selectedImageFiles[0].name
        : `${selectedImageFiles.length}개 이미지 선택됨 (최대 10개)`;
    imagePreview.classList.remove('hidden');
});
window.clearSelectedImage = resetSelectedImage;

function migrateDataFormat() {
    let modified = false;
    categories = Array.isArray(categories) ? categories.filter(Boolean) : [];
    if (!categories.length) {
        categories = [...DEFAULT_CATEGORIES];
        modified = true;
    }

    categories.forEach(category => {
        if (!Array.isArray(linkData[category])) {
            linkData[category] = [];
            modified = true;
        }
        if (linkData[category].length === 0 || linkData[category][0]?.url !== undefined) {
            const oldLinks = linkData[category]
                .filter(item => item?.url !== undefined)
                .map(link => ({ ...link, id: link.id || createId('link'), url: link.url || '', createdAt: link.createdAt || Date.now(), updatedAt: link.updatedAt || link.createdAt || Date.now() }));
            linkData[category] = [{ id: createId('sub'), title: '기본 분류', isOpen: true, links: oldLinks }];
            modified = true;
        } else {
            linkData[category].forEach(subcategory => {
                if (!subcategory.id) { subcategory.id = createId('sub'); modified = true; }
                if (!Array.isArray(subcategory.links)) { subcategory.links = []; modified = true; }
                subcategory.links.forEach(link => {
                    if (!link.id) { link.id = createId('link'); modified = true; }
                    const previousImages = JSON.stringify(link.images || []);
                    normalizeLinkImages(link, createId);
                    if (previousImages !== JSON.stringify(link.images || [])) modified = true;
                    const normalizedUrl = normalizeHttpUrl(link.url);
                    if (link.url !== normalizedUrl) { link.url = normalizedUrl; modified = true; }
                    if (!link.createdAt) { link.createdAt = Date.now(); modified = true; }
                    if (!link.updatedAt) { link.updatedAt = link.createdAt; modified = true; }
                });
            });
        }
    });

    Object.keys(linkData).forEach(category => {
        if (!categories.includes(category)) {
            delete linkData[category];
            modified = true;
        }
    });

    const normalized = normalizePreferences(uiPreferences);
    if (JSON.stringify(normalized) !== JSON.stringify(uiPreferences)) modified = true;
    uiPreferences = normalized;
    activeTab = categories.includes(activeTab) ? activeTab : uiPreferences.lastViewedTab;
    return modified;
}

function loadDataFromFirestore() {
    if (!currentUser) return;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    dataLoadState = 'loading';
    memoRevision = null;
    lastStableMemoData = null;

    unsubscribeSnapshot = memoRepository.subscribe(currentUser.uid, snapshot => {
        if (isDeletingAccount) return;
        if (snapshot.exists()) {
            const data = snapshot.data();
            categories = Array.isArray(data.categories) ? data.categories : [...DEFAULT_CATEGORIES];
            linkData = data.linkData && typeof data.linkData === 'object' ? data.linkData : {};
            uiPreferences = data.uiPreferences || createDefaultPreferences(categories[0]);
            driveConnection = normalizeDriveConnection(data.driveConnection);
            memoRevision = Number(data.revision || 0);
            backupInfo = data.backupInfo || null;
            backupState = createBackupState(data.backupState);
            dataLoadState = 'ready';
            const modified = migrateDataFormat();
            lastStableMemoData = cloneMemoPayload(buildMemoPayload());
            if (modified) void saveData({ skipBackup: true });
        } else {
            categories = [...DEFAULT_CATEGORIES];
            linkData = createDefaultLinkData(categories);
            uiPreferences = createDefaultPreferences(categories[0]);
            driveConnection = createDefaultDriveConnection();
            backupInfo = null;
            backupState = createBackupState();
            dataLoadState = 'missing';
            if (!dataSafetyAlertShown) {
                dataSafetyAlertShown = true;
                customAlert('저장 문서를 찾을 수 없습니다. 기존 데이터 보호를 위해 자동 초기화나 자동 저장을 하지 않았습니다. Firebase 데이터 복구 상태를 먼저 확인해주세요.');
            }
        }

        activeTab = categories.includes(uiPreferences.lastViewedTab) ? uiPreferences.lastViewedTab : categories[0];
        applyPreferences();
        if (canUseDrive(driveConnection) && dataLoadState === 'ready') void driveImageService.restoreSession(driveConnection);

        if (document.body.classList.contains('is-dragging') || document.body.classList.contains('is-tab-dragging') || document.body.classList.contains('is-subcategory-dragging')) return;
        if (isFirstLoad) {
            isFirstLoad = false;
            showHome();
            if (dataLoadState === 'ready') { void requestInitialDrivePermission(); void refreshBackupAuthentication(); }
        } else if (!mainApp.classList.contains('hidden')) {
            initApp();
        } else {
            renderHomeLanding();
        }
    }, error => {
        dataLoadState = 'error';
        console.error('Firestore read error:', error);
        customAlert('저장 데이터를 불러오지 못했습니다. 기존 데이터 보호를 위해 저장 기능을 중지했습니다.');
    });
}

async function createCloudBackup(reason, scheduledFor = null) {
    if (!currentUser || currentUser.isAnonymous) throw new Error('BACKUP_GUEST_UNSUPPORTED');
    if (!backupAuthReady) throw new Error('BACKUP_AUTH_NOT_READY');
    if (!backupService.configured()) throw new Error('BACKUP_WORKER_URL_MISSING');
    const snapshotData = cloneMemoPayload(buildMemoPayload());
    const primary = await memoRepository.createBackup(currentUser.uid, snapshotData, { revision: memoRevision || 0, reason });
    if (!primary) throw new Error('FIREBASE_BACKUP_FAILED');
    const descriptor = await backupService.create({ user: currentUser, backupId: primary.id, createdAt: primary.createdAt, reason, payload: snapshotData });
    descriptor.sourceRevision = memoRevision || 0;
    descriptor.scheduledFor = scheduledFor;
    const result = addBackupSuccess(backupState, descriptor);
    backupState = result.state; backupInfo = primary;
    return result.removed;
}
function backupErrorMessage(error) {
    const messages = {
        BACKUP_GUEST_UNSUPPORTED: '게스트 계정은 백업 및 복원을 이용할 수 없습니다. Google 계정을 연동해주세요.',
        BACKUP_AUTH_NOT_READY: '로그인 인증을 준비하는 중입니다. 잠시 후 다시 시도해주세요.',
        BACKUP_WORKER_URL_MISSING: 'Cloudflare 백업 서비스 주소가 설정되지 않았습니다.',
        WORKER_CONFIG_MISSING: 'Cloudflare Worker의 Firebase 프로젝트 또는 R2 연결 설정이 누락되었습니다.',
        TOKEN_PROJECT_MISMATCH: 'Cloudflare Worker의 Firebase 프로젝트 ID가 현재 앱과 일치하지 않습니다.',
        BACKUP_SERVICE_UNAVAILABLE: 'Cloudflare 백업 서비스의 인증 검증 처리에 실패했습니다. Worker 최신 코드가 배포되었는지 확인해주세요.',
        BACKUP_CHECKSUM_INVALID: '백업 파일 무결성 검증에 실패했습니다.',
        INVALID_TOKEN: '백업 인증을 자동 갱신하지 못했습니다. 네트워크 연결을 확인한 뒤 잠시 후 다시 시도해주세요.'
    };
    return messages[error?.message] || '백업 처리에 실패했습니다. 기존 백업은 안전하게 유지됩니다.';
}
async function saveData({ allowCreate = false, reason = 'change', forceBackup = false, skipBackup = false, scheduledFor = null } = {}) {
    if (!currentUser || isDeletingAccount || (dataLoadState !== 'ready' && !allowCreate)) return false;
    let staleBackups = [];
    let backupSucceeded = true;
    try {
        if (forceBackup) {
            await refreshBackupAuthentication({ forceRefresh: true });
            if (!backupAuthReady) throw new Error('BACKUP_AUTH_NOT_READY');
        }
        const now = Date.now();
        const shouldBackup = !skipBackup && backupAuthReady && !currentUser.isAnonymous && forceBackup;
        if (shouldBackup) {
            try { staleBackups = await createCloudBackup(reason === 'manual' ? 'manual' : 'auto', scheduledFor); }
            catch (error) { backupSucceeded = false; backupState = addBackupFailure(backupState, { reason:reason === 'manual' ? 'manual' : 'auto', createdAt:now, message:backupErrorMessage(error), scheduledFor }); if (reason === 'manual') throw error; }
        }
        const payload = buildMemoPayload();
        const result = await memoRepository.save(currentUser.uid, payload, { expectedRevision:memoRevision, allowCreate });
        memoRevision = result.revision; lastStableMemoData = cloneMemoPayload(payload); dataLoadState = 'ready';
        for (const stale of staleBackups) try { await backupService.remove({ user:currentUser, backupId:stale.id }); } catch (error) { console.warn('오래된 Cloudflare 백업 정리 실패', error); }
        return !forceBackup || backupSucceeded;
    } catch (error) {
        console.error('클라우드 저장 실패:', error); if (forceBackup && reason === 'manual') customAlert(backupErrorMessage(error));
        if (error?.code === 'MEMO_CONFLICT' || error?.message === 'MEMO_CONFLICT') loadDataFromFirestore();
        return false;
    }
}
function initApp() {
    renderTabs();
    renderSubCategorySelect();
    renderLinks();
}

function renderTabs() {
    activeTabActionController?.cancel();
    const tabsContainer = document.getElementById('tabsContainer');
    tabsContainer.innerHTML = '';

    const menuWrap = document.createElement('div');
    menuWrap.className = 'tab-menu-wrap';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'tab-menu-button flex items-center justify-center w-12 h-full min-h-[3rem] text-gray-600 hover:text-blue-600 hover:bg-gray-50 border-b-2 border-transparent';
    menuButton.title = '전체 탭 목록';
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.innerHTML = '<i class="fa-solid fa-bars text-lg"></i><span class="sr-only">전체 탭 메뉴</span>';
    const menuPanel = document.createElement('div');
    menuPanel.className = 'tab-menu-panel hidden mt-2 bg-white border border-gray-200 rounded-lg shadow-xl py-2';
    menuPanel.setAttribute('role', 'menu');
    menuButton.onclick = event => {
        event.stopPropagation();
        const opening = menuPanel.classList.contains('hidden');
        document.querySelectorAll('.tab-menu-panel').forEach(panel => panel.classList.add('hidden'));
        menuPanel.classList.toggle('hidden', !opening);
        menuButton.setAttribute('aria-expanded', String(opening));
    };
    categories.forEach(category => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `px-4 py-2 text-sm text-left hover:bg-blue-50 hover:text-blue-600 ${category === activeTab ? 'is-active font-bold text-blue-600 bg-blue-50' : 'text-gray-700'}`;
        item.textContent = category;
        item.onclick = () => {
            menuPanel.classList.add('hidden');
            menuButton.setAttribute('aria-expanded', 'false');
            showMain(category);
        };
        menuPanel.appendChild(item);
    });
    menuWrap.append(menuButton, menuPanel);

    const viewport = document.createElement('div');
    viewport.className = 'tabs-scroll-viewport';
    const list = document.createElement('div');
    list.className = 'tabs-scroll-list';
    categories.forEach(category => list.appendChild(createTabButton(category)));
    viewport.appendChild(list);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'tab-add-button flex items-center px-4 py-3 font-medium text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-50 border-b-2 border-transparent';
    addButton.innerHTML = '<i class="fa-solid fa-plus mr-1.5"></i>추가';
    addButton.onclick = () => window.addMainCategory();
    tabsContainer.append(menuWrap, viewport, addButton);
}

function createTabButton(category) {
    const isActive = category === activeTab;
    const tabButton = document.createElement('div');
    tabButton.className = `tab-button group flex items-center px-5 py-3 font-medium text-sm cursor-pointer ${isActive ? 'is-active text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-b-2 border-transparent'}`;
    tabButton.draggable = true;
    tabButton.dataset.category = category;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('tabindex', '0');
    tabButton.setAttribute('aria-selected', String(isActive));

    const label = document.createElement('span');
    label.textContent = category;
    const actions = document.createElement('span');
    actions.className = 'tab-actions hidden ml-2 items-center gap-1';
    actions.setAttribute('aria-label', `${category} 탭 관리`);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'text-gray-400 hover:text-blue-600 p-1';
    editButton.title = '탭 이름 수정';
    editButton.setAttribute('aria-label', `${category} 탭 이름 수정`);
    editButton.innerHTML = '<i class="fa-solid fa-pen-to-square text-xs" aria-hidden="true"></i>';
    editButton.onclick = event => { event.stopPropagation(); window.editMainCategory(category); };

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'text-gray-400 hover:text-red-500 p-1';
    deleteButton.title = '탭 삭제';
    deleteButton.setAttribute('aria-label', `${category} 탭 삭제`);
    deleteButton.innerHTML = '<i class="fa-solid fa-trash-can text-xs" aria-hidden="true"></i>';
    deleteButton.onclick = event => { event.stopPropagation(); window.deleteMainCategory(category); };
    actions.append(editButton, deleteButton);
    tabButton.append(label, actions);

    let controller;
    let pointerIsDown = false;
    let touchHoldPending = false;
    let suppressNextActivation = false;
    controller = createHoldActions({
        onOpen: () => {
            if (touchHoldPending) suppressNextActivation = true;
            if (activeTabActionController && activeTabActionController !== controller) activeTabActionController.cancel();
            activeTabActionController = controller;
            actions.classList.remove('hidden');
            actions.classList.add('inline-flex');
        },
        onClose: () => {
            actions.classList.add('hidden');
            actions.classList.remove('inline-flex');
            if (activeTabActionController === controller) activeTabActionController = null;
        }
    });

    tabButton.onclick = event => {
        if (event.target.closest('.tab-actions')) return;
        if (suppressNextActivation) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextActivation = false;
            return;
        }
        controller.cancel();
        showMain(category);
    };
    tabButton.onkeydown = event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.tab-actions')) {
            event.preventDefault();
            showMain(category);
        }
        if (event.key === 'Escape') controller.cancel();
    };
    tabButton.addEventListener('mouseenter', () => controller.open());
    tabButton.addEventListener('mouseleave', () => { if (!tabButton.contains(document.activeElement)) controller.cancel(); });
    tabButton.addEventListener('pointerdown', event => {
        pointerIsDown = true;
        if (event.pointerType !== 'mouse') {
            touchHoldPending = true;
            controller.start();
        }
    });
    ['pointerup', 'pointercancel'].forEach(name => tabButton.addEventListener(name, event => {
        pointerIsDown = false;
        if (event.pointerType !== 'mouse' && !controller.isOpen()) controller.cancel();
        touchHoldPending = false;
    }));
    tabButton.addEventListener('focusin', () => { if (!pointerIsDown) controller.open(); });
    tabButton.addEventListener('focusout', event => { if (!tabButton.contains(event.relatedTarget)) controller.cancel(); });
    tabButton.addEventListener('dragstart', event => {
        if (event.target.closest('button')) return event.preventDefault();
        controller.cancel();
        draggedTab = category;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', category);
        document.body.classList.add('is-tab-dragging');
        setTimeout(() => tabButton.classList.add('is-dragging'), 0);
    });
    tabButton.addEventListener('dragend', () => {
        draggedTab = null;
        document.body.classList.remove('is-tab-dragging');
        document.querySelectorAll('.tab-button').forEach(tab => tab.classList.remove('drag-over', 'is-dragging'));
    });
    tabButton.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    tabButton.addEventListener('dragenter', () => { if (draggedTab && draggedTab !== category) tabButton.classList.add('drag-over'); });
    tabButton.addEventListener('dragleave', () => tabButton.classList.remove('drag-over'));
    tabButton.addEventListener('drop', event => {
        event.preventDefault();
        if (!draggedTab || draggedTab === category) return;
        const from = categories.indexOf(draggedTab);
        const [moved] = categories.splice(from, 1);
        const target = categories.indexOf(category);
        categories.splice(target, 0, moved);
        saveData();
        renderTabs();
        renderHomeLanding();
    });
    return tabButton;
}
window.addMainCategory = () => {
    customPrompt('새 탭 이름을 입력하세요.', '', async newCategory => {
        const name = newCategory.trim();
        if (!name) return;
        if (categories.includes(name)) return customAlert('이미 존재하는 탭입니다.');
        categories.push(name);
        linkData[name] = [{ id: createId('sub'), title: '기본 분류', isOpen: true, links: [] }];
        activeTab = name;
        uiPreferences.lastViewedTab = name;
        await saveData();
        showMain(name);
    });
};

window.editMainCategory = oldCategory => {
    customPrompt(`'${oldCategory}' 탭의 새 이름을 입력하세요.`, oldCategory, async newCategory => {
        const name = newCategory.trim();
        if (!name || name === oldCategory) return;
        if (categories.includes(name)) return customAlert('이미 존재하는 탭입니다.');
        const index = categories.indexOf(oldCategory);
        categories[index] = name;
        linkData[name] = linkData[oldCategory];
        delete linkData[oldCategory];
        if (activeTab === oldCategory) activeTab = name;
        if (uiPreferences.lastViewedTab === oldCategory) uiPreferences.lastViewedTab = name;
        await saveData();
        showMain(activeTab);
    });
};

window.deleteMainCategory = category => {
    if (categories.length <= 1) return customAlert('최소 한 개의 탭은 유지해야 합니다.');
    customConfirm(`'${category}' 탭과 포함된 모든 데이터를 삭제하시겠습니까?`, async () => {
        (linkData[category] || []).flatMap(subcategory => subcategory.links || []).forEach(link => deleteImage(link.imageId));
        categories = categories.filter(item => item !== category);
        delete linkData[category];
        if (activeTab === category) activeTab = categories[0];
        if (uiPreferences.lastViewedTab === category) uiPreferences.lastViewedTab = activeTab;
        await saveData();
        showMain(activeTab);
    });
};

function renderSubCategorySelect() {
    const select = document.getElementById('subCategorySelect');
    const subcategories = linkData[activeTab] || [];
    select.innerHTML = '';
    document.getElementById('currentTabLabel').textContent = `${activeTab} 내역`;
    subcategories.forEach((subcategory, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = subcategory.title;
        select.appendChild(option);
    });
}

window.addSubcategory = () => {
    customPrompt('새 소분류 이름을 입력하세요.', '', async value => {
        const name = value.trim();
        if (!name) return;
        linkData[activeTab].push({ id: createId('sub'), title: name, isOpen: true, links: [] });
        await saveData();
        initApp();
    });
};

window.editSubcategory = (subIndex, oldName) => {
    customPrompt(`'${oldName}' 소분류의 새 이름을 입력하세요.`, oldName, async value => {
        const name = value.trim();
        if (!name || name === oldName) return;
        linkData[activeTab][subIndex].title = name;
        await saveData();
        initApp();
    });
};

window.deleteSubcategory = (subIndex, name) => {
    customConfirm(`'${name}' 소분류와 포함된 링크를 삭제하시겠습니까?`, async () => {
        const [removed] = linkData[activeTab].splice(subIndex, 1);
        (removed?.links || []).forEach(link => deleteImage(link.imageId));
        if (!linkData[activeTab].length) linkData[activeTab].push({ id: createId('sub'), title: '기본 분류', isOpen: true, links: [] });
        await saveData();
        initApp();
    });
};

window.toggleSubcategory = async subIndex => {
    linkData[activeTab][subIndex].isOpen = !linkData[activeTab][subIndex].isOpen;
    await saveData();
    renderLinks();
};

function renderLinks() {
    const linksContainer = document.getElementById('linksContainer');
    const emptyState = document.getElementById('emptyState');
    const subcategories = linkData[activeTab] || [];
    linksContainer.innerHTML = '';
    if (!subcategories.length) {
        linksContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
        return;
    }
    linksContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');
    subcategories.forEach((subcategory, subIndex) => linksContainer.appendChild(createSubcategoryPanel(subcategory, subIndex)));
}

function createSubcategoryPanel(subcategory, subIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subcategory-panel bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden';
    wrapper.dataset.subId = subcategory.id;
    wrapper.addEventListener('dragover', event => { if (draggedSubcategoryId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    wrapper.addEventListener('dragenter', () => { if (draggedSubcategoryId && draggedSubcategoryId !== subcategory.id) wrapper.classList.add('drag-over'); });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
    wrapper.addEventListener('drop', event => {
        if (!draggedSubcategoryId || draggedSubcategoryId === subcategory.id) return;
        event.preventDefault();
        const from = linkData[activeTab].findIndex(item => item.id === draggedSubcategoryId);
        const [moved] = linkData[activeTab].splice(from, 1);
        const target = linkData[activeTab].findIndex(item => item.id === subcategory.id);
        linkData[activeTab].splice(target, 0, moved);
        saveData();
        initApp();
    });

    const header = document.createElement('div');
    header.className = `subcat-header flex justify-between items-center bg-gray-50 hover:bg-gray-100 px-4 py-3 cursor-pointer select-none border-b ${subcategory.isOpen ? 'border-gray-200' : 'border-transparent is-closed'}`;
    header.draggable = true;
    header.addEventListener('dragstart', event => {
        if (event.target.closest('button')) return event.preventDefault();
        draggedSubcategoryId = subcategory.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', subcategory.id);
        document.body.classList.add('is-subcategory-dragging');
        setTimeout(() => wrapper.classList.add('is-dragging'), 0);
    });
    header.addEventListener('dragend', () => {
        draggedSubcategoryId = null;
        document.body.classList.remove('is-subcategory-dragging');
        document.querySelectorAll('.subcategory-panel').forEach(panel => panel.classList.remove('drag-over', 'is-dragging'));
    });

    const title = document.createElement('div');
    title.className = 'flex items-center flex-1 min-w-0';
    title.onclick = () => window.toggleSubcategory(subIndex);
    title.innerHTML = `<i class="fa-solid fa-grip-vertical text-gray-300 mr-2 text-sm"></i><i class="fa-solid fa-chevron-down text-gray-400 mr-3 text-sm"></i><h3 class="font-bold text-gray-700 truncate">${escapeHtml(subcategory.title)} <span class="text-xs text-gray-400 ml-1 font-normal">(${subcategory.links.length})</span></h3>`;

    const actions = document.createElement('div');
    actions.className = 'flex gap-2 shrink-0';
    actions.append(
        createIconButton('fa-solid fa-pen-to-square', '소분류 수정', event => { event.stopPropagation(); window.editSubcategory(subIndex, subcategory.title); }),
        createIconButton('fa-solid fa-trash-can', '소분류 삭제', event => { event.stopPropagation(); window.deleteSubcategory(subIndex, subcategory.title); })
    );
    header.append(title, actions);

    const grid = document.createElement('div');
    grid.className = `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-4 ${subcategory.isOpen ? '' : 'hidden'}`;
    grid.dataset.subId = subcategory.id;
    grid.addEventListener('dragover', event => { if (draggedItem) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    grid.addEventListener('drop', event => {
        if (!draggedItem || event.target !== grid) return;
        event.preventDefault();
        moveDraggedLink(subcategory.id, null);
    });
    if (!subcategory.links.length) {
        const note = document.createElement('div');
        note.className = 'col-span-full text-center text-sm text-gray-400 py-2 italic pointer-events-none';
        note.textContent = '저장된 항목이 없습니다. 항목을 추가하거나 이곳으로 드래그하세요.';
        grid.appendChild(note);
    }
    subcategory.links.forEach((item, linkIndex) => grid.appendChild(createLinkCard(item, subIndex, linkIndex)));
    wrapper.append(header, grid);
    return wrapper;
}

function createIconButton(icon, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-gray-400 hover:text-blue-500 p-1';
    button.title = title;
    button.innerHTML = `<i class="${icon}"></i>`;
    button.onclick = onClick;
    return button;
}

function findDraggedLink() {
    if (!draggedItem) return null;
    const sourceSubcategory = linkData[activeTab].find(item => item.id === draggedItem.subcategoryId);
    const sourceIndex = sourceSubcategory?.links.findIndex(item => item.id === draggedItem.linkId) ?? -1;
    if (!sourceSubcategory || sourceIndex < 0) return null;
    return { sourceSubcategory, sourceIndex };
}

function moveDraggedLink(targetSubcategoryId, targetLinkId) {
    const source = findDraggedLink();
    const targetSubcategory = linkData[activeTab].find(item => item.id === targetSubcategoryId);
    if (!source || !targetSubcategory) return;
    const [moved] = source.sourceSubcategory.links.splice(source.sourceIndex, 1);
    const targetIndex = targetLinkId ? targetSubcategory.links.findIndex(item => item.id === targetLinkId) : targetSubcategory.links.length;
    targetSubcategory.links.splice(targetIndex < 0 ? targetSubcategory.links.length : targetIndex, 0, moved);
    saveData();
    renderLinks();
}

function createLinkCard(item, subIndex, linkIndex) {
    const subcategory = linkData[activeTab][subIndex];
    const card = document.createElement('div');
    card.className = 'link-card group flex flex-col gap-1.5 cursor-move h-full';
    card.draggable = true;
    card.addEventListener('dragstart', event => {
        if (event.target.closest('button') && !event.target.closest('.link-primary')) return event.preventDefault();
        draggedItem = { subcategoryId: subcategory.id, linkId: item.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
        document.body.classList.add('is-dragging');
        setTimeout(() => card.classList.add('opacity-40'), 0);
    });
    card.addEventListener('dragend', () => {
        draggedItem = null;
        document.body.classList.remove('is-dragging');
        card.classList.remove('opacity-40');
        document.querySelectorAll('.link-card').forEach(element => element.classList.remove('ring-2', 'ring-blue-500'));
    });
    card.addEventListener('dragover', event => { if (draggedItem) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    card.addEventListener('dragenter', () => { if (draggedItem?.linkId !== item.id) card.classList.add('ring-2', 'ring-blue-500'); });
    card.addEventListener('dragleave', () => card.classList.remove('ring-2', 'ring-blue-500'));
    card.addEventListener('drop', event => {
        if (!draggedItem || draggedItem.linkId === item.id) return;
        event.preventDefault();
        event.stopPropagation();
        moveDraggedLink(subcategory.id, item.id);
    });

    const box = document.createElement('div');
    const commentOnly = isCommentOnlyMemo(item);
    const previewKind = getMemoPreviewKind(item);
    box.className = `relative bg-white border border-gray-200 group-hover:border-blue-300 rounded-lg shadow-sm group-hover:shadow-md overflow-hidden flex items-stretch min-h-[3.5rem] w-full ${item.imageId ? 'link-has-image' : ''} ${commentOnly ? 'comment-accordion-shell' : ''}`;
    const primary = document.createElement(item.url ? 'a' : 'button');
    primary.className = 'link-primary flex-1 flex items-center justify-center p-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50 transition-colors w-full overflow-hidden cursor-pointer';
    primary.draggable = false;

    let commentPanel = null;
    if (commentOnly) {
        primary.type = 'button';
        primary.classList.add('comment-accordion-trigger');
        primary.setAttribute('aria-expanded', 'false');
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-down text-xs text-gray-400 mr-2 comment-accordion-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'font-medium truncate text-center leading-tight';
        title.textContent = item.text;
        primary.append(chevron, title);
        commentPanel = document.createElement('div');
        commentPanel.className = 'comment-accordion-content hidden';
        commentPanel.textContent = item.comment;
        primary.onclick = () => {
            const opening = primary.getAttribute('aria-expanded') !== 'true';
            primary.setAttribute('aria-expanded', String(opening));
            commentPanel.classList.toggle('hidden', !opening);
        };
    } else {
        const title = document.createElement('span');
        title.className = 'font-medium truncate w-full text-center leading-tight';
        title.textContent = item.text;
        primary.appendChild(title);
        if (item.url) {
            primary.href = item.url;
            primary.target = '_blank';
            primary.rel = 'noopener noreferrer';
        } else {
            primary.type = 'button';
            primary.title = '첨부 이미지 보기';
            primary.onclick = () => showContentPreview(item);
        }
    }
    if (previewKind !== 'none') attachPreviewHandlers(primary, item);

    const actions = document.createElement('div');
    actions.className = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 transition-opacity';
    actions.append(
        createRoundActionButton('fa-solid fa-pen', '텍스트 수정', event => { event.preventDefault(); event.stopPropagation(); window.editLinkText(subIndex, linkIndex); }),
        createRoundActionButton('fa-regular fa-comment-dots', '코멘트 수정', event => { event.preventDefault(); event.stopPropagation(); window.editLinkComment(subIndex, linkIndex); }),
        createRoundActionButton('fa-regular fa-image', hasLinkImages(item) ? '이미지 추가' : '이미지 추가', event => { event.preventDefault(); event.stopPropagation(); window.editLinkImage(subIndex, linkIndex); })
    );
    if (hasLinkImages(item)) actions.appendChild(createRoundActionButton('fa-solid fa-trash-can', '이미지 제거', event => { event.preventDefault(); event.stopPropagation(); window.removeLinkImage(subIndex, linkIndex); }, 'bg-orange-100 text-orange-600'));
    actions.appendChild(createRoundActionButton('fa-solid fa-xmark', '항목 삭제', event => { event.preventDefault(); event.stopPropagation(); window.deleteLink(subIndex, linkIndex); }, 'bg-red-100 text-red-500'));
    const upload = item.imageUpload;
    if (upload?.state === 'processing') {
        const status = document.createElement('span');
        status.className = 'absolute left-2 bottom-1 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5';
        status.textContent = `이미지 저장 중 ${upload.completed}/${upload.total}`;
        box.appendChild(status);
    }
    box.append(primary, actions);
    card.appendChild(box);
    if (commentPanel) card.appendChild(commentPanel);
    if (!commentOnly && item.comment) {
        const comment = document.createElement('div');
        comment.className = 'memo-comment text-xs text-gray-500 px-1.5 pb-1 break-words text-center leading-snug w-full';
        comment.textContent = item.comment;
        card.appendChild(comment);
    }
    return card;
}
function createRoundActionButton(icon, title, onClick, baseClass = 'bg-gray-100 text-gray-500') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `w-7 h-7 rounded-full ${baseClass} hover:bg-blue-500 hover:text-white flex items-center justify-center shadow-sm`;
    button.title = title;
    button.innerHTML = `<i class="${icon} text-sm"></i>`;
    button.onclick = onClick;
    return button;
}

function setPreviewMode(mode) {
    const showText = mode === 'text';
    previewTextTab.setAttribute('aria-selected', String(showText));
    previewImageTab.setAttribute('aria-selected', String(!showText));
    previewTextStage.classList.toggle('hidden', !showText);
    previewImageStage.classList.toggle('hidden', showText);
}

function attachPreviewHandlers(target, item) {
    let suppressNextClick = false;
    target.addEventListener('mouseenter', () => {
        driveImageService.prefetchImage(getLinkImages(item)[0] || item, driveConnection);
        hoverPreviewTimer = setTimeout(() => showContentPreview(item), 160);
    });
    target.addEventListener('mouseleave', clearPreviewTimers);
    target.addEventListener('focus', () => {
        driveImageService.prefetchImage(getLinkImages(item)[0] || item, driveConnection);
        showContentPreview(item);
    });
    target.addEventListener('pointerdown', () => {
        driveImageService.prefetchImage(getLinkImages(item)[0] || item, driveConnection);
        longPressTimer = setTimeout(() => {
            suppressNextClick = true;
            showContentPreview(item);
        }, 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(eventName => target.addEventListener(eventName, () => {
        clearPreviewTimers();
        if (suppressNextClick) setTimeout(() => { suppressNextClick = false; }, 350);
    }));
    target.addEventListener('click', event => {
        if (!suppressNextClick) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

function clearPreviewTimers() {
    clearTimeout(hoverPreviewTimer);
    clearTimeout(longPressTimer);
}

function updateCarouselControls() {
    const multiple = previewAttachments.length > 1;
    carouselControls.classList.toggle('hidden', !multiple);
    carouselCounter.textContent = previewAttachments.length ? `${previewImageIndex + 1} / ${previewAttachments.length}` : '';
}

function prefetchCarouselNeighbors() {
    if (previewAttachments.length < 2) return;
    const previous = previewAttachments[(previewImageIndex - 1 + previewAttachments.length) % previewAttachments.length];
    const next = previewAttachments[(previewImageIndex + 1) % previewAttachments.length];
    driveImageService.prefetchImage(previous, driveConnection);
    driveImageService.prefetchImage(next, driveConnection);
}

async function loadPreviewImage(index, requestId = previewRequestId) {
    const attachment = previewAttachments[index];
    if (!attachment) return;
    previewImageIndex = index;
    updateCarouselControls();
    carouselLoading.classList.remove('hidden');
    const imageRecord = await driveImageService.loadImage(attachment, driveConnection);
    if (imageRecord?.driveMissing) void repairMissingDriveImage(attachment);
    if (requestId !== previewRequestId) return;
    carouselLoading.classList.add('hidden');
    if (!imageRecord?.blob) return;
    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = URL.createObjectURL(imageRecord.blob);
    imagePreviewModalImg.src = modalObjectUrl;
    prefetchCarouselNeighbors();
}

function moveCarousel(delta) {
    if (previewAttachments.length < 2) return;
    const next = (previewImageIndex + delta + previewAttachments.length) % previewAttachments.length;
    void loadPreviewImage(next);
}

async function showContentPreview(item) {
    clearPreviewTimers();
    const kind = getMemoPreviewKind(item);
    if (kind === 'none') return;
    const requestId = ++previewRequestId;
    const hasText = kind === 'text' || kind === 'combined';
    previewItem = item;
    previewAttachments = getLinkImages(item);
    previewImageIndex = 0;
    const hasImage = previewAttachments.length > 0;
    if (!hasText && !hasImage) return;

    imagePreviewModalTitle.textContent = item.text || '미리보기';
    previewTextContent.textContent = hasText ? item.comment : '';
    previewTextTab.classList.toggle('hidden', !hasText);
    previewImageTab.classList.toggle('hidden', !hasImage);
    previewTabs.classList.toggle('hidden', !(hasText && hasImage));
    updateCarouselControls();
    if (hasImage) {
        imagePreviewModalImg.removeAttribute('src');
        void loadPreviewImage(0, requestId);
    } else {
        imagePreviewModalImg.removeAttribute('src');
    }
    setPreviewMode(hasText ? 'text' : 'image');
    imagePreviewModal.classList.remove('hidden');
}

async function repairMissingDriveImage(item) {
    const key = item?.id || item?.imageId;
    if (!key || repairingDriveImageIds.has(key) || !canUseDrive(driveConnection)) return;
    repairingDriveImageIds.add(key);
    try {
        const repair = await driveImageService.repairImage(item, driveConnection);
        driveConnection = repair.connection;
        if (repair.repaired) {
            driveImageRepository.clearCache();
            await saveData();
            setDriveSyncStatus('유실된 Drive 이미지를 자동 복구했습니다.');
        } else if (repair.reason === 'LOCAL_IMAGE_MISSING') {
            await saveData();
            setDriveSyncStatus('일부 Drive 이미지의 원본이 현재 PC에 없어 다시 첨부해야 합니다.');
        }
    } catch (error) {
        console.warn('유실된 Drive 이미지 자동 복구 실패', error);
    } finally {
        repairingDriveImageIds.delete(key);
    }
}

function hideImagePreview() {
    clearPreviewTimers();
    previewRequestId += 1;
    imagePreviewModal.classList.add('hidden');
    imagePreviewModalImg.removeAttribute('src');
    previewTextContent.textContent = '';
    previewAttachments = [];
    previewItem = null;
    previewImageIndex = 0;
    carouselControls.classList.add('hidden');
    carouselCounter.textContent = '';
    carouselLoading.classList.add('hidden');
    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = null;
}
window.hideImagePreview = hideImagePreview;
previewTextTab.onclick = () => setPreviewMode('text');
previewImageTab.onclick = () => setPreviewMode('image');
carouselPreviousButton.onclick = () => moveCarousel(-1);
carouselNextButton.onclick = () => moveCarousel(1);
previewImageStage.addEventListener('pointerdown', event => { carouselPointerStartX = event.clientX; });
previewImageStage.addEventListener('pointerup', event => {
    if (carouselPointerStartX === null) return;
    const distance = event.clientX - carouselPointerStartX;
    carouselPointerStartX = null;
    if (Math.abs(distance) >= 40) moveCarousel(distance > 0 ? -1 : 1);
});
previewImageStage.addEventListener('pointercancel', () => { carouselPointerStartX = null; });

window.handleKeyPress = event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        window.saveLink();
    }
};

function findLinkById(linkId) {
    for (const subcategories of Object.values(linkData)) {
        for (const subcategory of subcategories || []) {
            const link = subcategory.links?.find(item => item.id === linkId);
            if (link) return link;
        }
    }
    return null;
}

function scheduleBackgroundImageSave() {
    clearTimeout(queuedImageSaveTimer);
    queuedImageSaveTimer = setTimeout(async () => {
        await saveData();
    }, 350);
}

async function processSelectedImagesInBackground(linkId, files) {
    const result = await imageAttachmentQueue.process({
        files,
        onAttachment: attachment => {
            const link = findLinkById(linkId);
            if (!link) return;
            link.images.push(attachment);
            renderLinks();
            scheduleBackgroundImageSave();
        },
        onProgress: progress => {
            const link = findLinkById(linkId);
            if (!link) return;
            link.imageUpload = {
                total: progress.total,
                completed: progress.completed,
                failed: progress.failed,
                pending: progress.pending,
                driveFailed: progress.driveFailed,
                state: progress.pending ? 'processing' : 'complete'
            };
            renderLinks();
            scheduleBackgroundImageSave();
        }
    });
    const link = findLinkById(linkId);
    if (!link) return result;
    clearTimeout(queuedImageSaveTimer);
    if (!result.failed && !result.driveFailed) delete link.imageUpload;
    else link.imageUpload = {
        total: result.total,
        completed: result.completed,
        failed: result.failed,
        pending: 0,
        driveFailed: result.driveFailed,
        state: 'complete'
    };
    await saveData();
    renderLinks();
    renderHomeLanding();
    if (result.failed || result.driveFailed) {
        customAlert(`이미지 저장 완료: 로컬 저장 실패 ${result.failed}개, Drive 업로드 실패 ${result.driveFailed}개입니다.`);
    }
    return result;
}

window.saveLink = async () => {
    const select = document.getElementById('subCategorySelect');
    const textInput = document.getElementById('linkText');
    const urlInput = document.getElementById('linkUrl');
    const commentInput = document.getElementById('linkComment');
    const subIndex = Number(select.value);
    const result = normalizeMemoInput({
        text: textInput.value,
        url: urlInput.value,
        comment: commentInput.value,
        hasImage: selectedImageFiles.length > 0
    });

    if (!Number.isInteger(subIndex) || !linkData[activeTab]?.[subIndex]) return customAlert('저장할 소분류를 먼저 추가해주세요.');
    if (!result.ok) return customAlert(result.error);
    const { text, url, comment } = result.value;
    const files = [...selectedImageFiles];
    if (files.length && !canUseDrive(driveConnection)) warnLocalOnlyImageStorage();

    const link = {
        id: createId('link'),
        text,
        url,
        comment,
        images: [],
        imageUpload: files.length ? { total: files.length, completed: 0, failed: 0, pending: files.length, driveFailed: 0, state: 'processing' } : null,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    if (!files.length) delete link.imageUpload;
    linkData[activeTab][subIndex].links.push(link);
    await saveData();
    renderLinks();
    renderHomeLanding();
    textInput.value = '';
    urlInput.value = '';
    commentInput.value = '';
    resetSelectedImage();
    textInput.focus();

    if (files.length) void processSelectedImagesInBackground(link.id, files);
};
window.deleteLink = (subIndex, linkIndex) => {
    customConfirm('이 항목을 삭제하시겠습니까?', async () => {
        const [removed] = linkData[activeTab][subIndex].links.splice(linkIndex, 1);
        for (const image of getLinkImages(removed)) {
            await memoService.deleteImage(image.imageId);
            await driveImageService.removeDriveImage(image.driveImage);
        }
        await saveData();
        renderLinks();
        renderHomeLanding();
    });
};

function populateLinkEditSubcategories(category, selectedId) {
    linkEditSubcategory.innerHTML = '';
    (linkData[category] || []).forEach(subcategory => {
        const option = document.createElement('option');
        option.value = subcategory.id;
        option.textContent = subcategory.title;
        option.selected = subcategory.id === selectedId;
        linkEditSubcategory.appendChild(option);
    });
}

window.editLinkText = (subIndex, linkIndex) => {
    const sourceSubcategory = linkData[activeTab]?.[subIndex];
    const link = sourceSubcategory?.links?.[linkIndex];
    if (!sourceSubcategory || !link) return;
    editingLinkContext = { sourceCategory: activeTab, sourceSubcategoryId: sourceSubcategory.id, linkId: link.id };
    linkEditText.value = link.text || '';
    linkEditCategory.innerHTML = '';
    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        option.selected = category === activeTab;
        linkEditCategory.appendChild(option);
    });
    populateLinkEditSubcategories(activeTab, sourceSubcategory.id);
    linkEditModal.classList.remove('hidden');
    linkEditText.focus();
};

window.closeLinkEditModal = () => {
    linkEditModal.classList.add('hidden');
    editingLinkContext = null;
};

linkEditCategory.addEventListener('change', () => populateLinkEditSubcategories(linkEditCategory.value));

window.saveLinkEdit = async () => {
    if (!editingLinkContext) return;
    const result = relocateLink({
        linkData,
        ...editingLinkContext,
        targetCategory: linkEditCategory.value,
        targetSubcategoryId: linkEditSubcategory.value,
        text: linkEditText.value
    });
    if (!result.ok) return customAlert(result.error);
    const moved = result.moved;
    window.closeLinkEditModal();
    await saveData();
    renderLinks();
    renderHomeLanding();
    customAlert(moved ? '링크를 수정하고 선택한 카테고리로 이동했습니다.' : '링크 텍스트를 수정했습니다.');
};
window.editLinkComment = (subIndex, linkIndex) => {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    customPrompt('코멘트를 입력하세요.', link.comment || '', async value => {
        if (!value.trim() && !link.url && !hasLinkImages(link)) return customAlert('링크, 이미지 또는 코멘트 중 하나는 유지해야 합니다.');
        link.comment = value;
        link.updatedAt = Date.now();
        await saveData();
        renderLinks();
    });
};

window.editLinkImage = (subIndex, linkIndex) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.onchange = async () => {
        const validation = validateImageSelection(picker.files);
        if (!validation.ok) return customAlert(validation.error);
        if (!validation.value.length) return;
        const link = linkData[activeTab][subIndex].links[linkIndex];
        const existing = getLinkImages(link);
        if (existing.length + validation.value.length > 10) return customAlert(`이미지는 링크당 최대 10개까지 첨부할 수 있습니다. 현재 ${existing.length}개가 있습니다.`);
        if (!canUseDrive(driveConnection)) warnLocalOnlyImageStorage();
        try {
            const added = [];
            for (const file of validation.value) {
                const imageId = await saveImageFile(file);
                const driveImage = canUseDrive(driveConnection) ? await saveDriveImage(file) : null;
                added.push({ id: createId('image'), imageId, driveImage });
            }
            link.images = [...existing, ...added];
            link.updatedAt = Date.now();
            await saveData();
            renderLinks();
        } catch (error) {
            console.error('이미지 저장 실패:', error);
            customAlert('이미지 저장에 실패했습니다.');
        }
    };
    picker.click();
};

window.removeLinkImage = (subIndex, linkIndex) => {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    if (!hasLinkImages(link)) return;
    if (!link.url && !link.comment?.trim()) return customAlert('링크나 코멘트가 없는 이미지 전용 항목에서는 이미지를 제거할 수 없습니다.');
    customConfirm('첨부 이미지를 제거하시겠습니까?', async () => {
        for (const image of getLinkImages(link)) {
            await memoService.deleteImage(image.imageId);
            await driveImageService.removeDriveImage(image.driveImage);
        }
        link.images = [];
        link.updatedAt = Date.now();
        await saveData();
        renderLinks();
    });
};

function formatBackupTime(value) { return value ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(value)) : '-'; }
function renderBackupSettings() {
    if (!backupStatus || !backupList) return;
    if (currentUser?.isAnonymous) { backupStatus.textContent='게스트 계정은 백업 및 복원을 이용할 수 없습니다. Google 계정을 연동해주세요.'; backupList.innerHTML=''; return; }
    const auto=backupState.auto||{};
    const currentSessionFailure=auto.lastStatus==='failure' && (!backupSessionStartedAt || (auto.lastAttemptAt && auto.lastAttemptAt >= backupSessionStartedAt));
    backupStatus.textContent=!backupAuthReady ? '로그인 인증을 준비하는 중입니다. 백업 기능이 곧 활성화됩니다.' : currentSessionFailure ? `자동 백업 실패: ${auto.lastError||'원인을 확인해주세요.'}` : auto.lastSuccessAt && (!backupSessionStartedAt || auto.lastSuccessAt >= backupSessionStartedAt) ? `최근 자동 백업 성공: ${formatBackupTime(auto.lastSuccessAt)} · 다음 백업: ${formatBackupTime(nextAutomaticBackupAt)}` : `백업 인증이 준비되었습니다. 다음 자동 백업: ${formatBackupTime(nextAutomaticBackupAt)}`;
    backupList.innerHTML='';
    backupState.backups.forEach(backup=>{ const item=document.createElement('div'); item.className='rounded border border-gray-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'; item.innerHTML=`<div><p class="font-semibold text-sm text-gray-800">${backup.reason==='manual'?'수동':'자동'} 백업</p><p class="text-xs text-gray-500">${formatBackupTime(backup.createdAt)} · ${Math.ceil((backup.size||0)/1024)}KB</p></div><div class="flex gap-2"><button class="backup-download secondary-command border border-blue-300 text-blue-700 px-3 py-1.5 rounded text-sm" data-id="${backup.id}">다운로드</button><button class="backup-restore secondary-command border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded text-sm" data-id="${backup.id}">복원</button></div>`; backupList.appendChild(item); });
    backupList.querySelectorAll('.backup-download').forEach(button=>button.onclick=()=>window.downloadCloudBackup(button.dataset.id));
    backupList.querySelectorAll('.backup-restore').forEach(button=>button.onclick=()=>window.restoreCloudBackup(button.dataset.id));
}
async function applyBackupPayload(payload) {
    categories=Array.isArray(payload.categories)?payload.categories:[...DEFAULT_CATEGORIES]; linkData=payload.linkData&&typeof payload.linkData==='object'?payload.linkData:createDefaultLinkData(categories); uiPreferences=payload.uiPreferences||createDefaultPreferences(categories[0]); driveConnection=normalizeDriveConnection(payload.driveConnection);
    const state=backupState; backupInfo=payload.backupInfo||backupInfo; backupState=state; migrateDataFormat(); await saveData({skipBackup:true}); applyPreferences(); showHome(); renderBackupSettings();
}
window.requestCloudBackup=async()=>{
    if(currentUser?.isAnonymous) return customAlert('게스트 계정은 백업 및 복원을 이용할 수 없습니다. Google 계정을 연동해주세요.');
    if (manualBackupButton?.disabled) return;
    const original = manualBackupButton?.innerHTML;
    if (manualBackupButton) {
        manualBackupButton.disabled = true;
        manualBackupButton.classList.add('opacity-60','cursor-not-allowed');
        manualBackupButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>인증 갱신·백업 중';
    }
    try {
        const ok=await saveData({forceBackup:true,reason:'manual'});
        if(ok){renderBackupSettings();customAlert('현재 시점의 Cloudflare 백업이 완료되었습니다. 최신 3개만 안전하게 보존됩니다.');}
    } finally {
        if (manualBackupButton) {
            manualBackupButton.disabled = false;
            manualBackupButton.classList.remove('opacity-60','cursor-not-allowed');
            manualBackupButton.innerHTML = original;
        }
    }
};
window.downloadCloudBackup=async backupId=>{ try { const envelope=await backupService.load({user:currentUser,backupId}); const blob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`link-memo-backup-${backupId}.json`; link.click(); URL.revokeObjectURL(link.href); } catch(error){customAlert(backupErrorMessage(error));} };
window.restoreCloudBackup=async backupId=>{ try { const envelope=await backupService.load({user:currentUser,backupId}); const validation=validateImportedBackup(envelope,currentUser.uid); if(!validation.ok)return customAlert(validation.error); customConfirm(`${formatBackupTime(envelope.createdAt)} 백업으로 현재 데이터를 복원하시겠습니까?`,async()=>{await applyBackupPayload(validation.value);customAlert('백업 데이터를 복원했습니다.');}); }catch(error){customAlert(backupErrorMessage(error));} };
window.openBackupFilePicker=()=>backupFileInput?.click();
backupFileInput?.addEventListener('change',async()=>{const file=backupFileInput.files?.[0];backupFileInput.value='';if(!file)return;try{const validation=validateImportedBackup(JSON.parse(await file.text()),currentUser.uid);if(!validation.ok)return customAlert(validation.error);customConfirm('선택한 백업 파일로 현재 데이터를 복원하시겠습니까?',async()=>{await applyBackupPayload(validation.value);customAlert('백업 파일을 복원했습니다.');});}catch{customAlert('백업 파일을 읽을 수 없습니다.');}});

function openSettingsModal() {
    applyPreferences();
    renderBackupSettings();
    settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
    settingsModal.classList.add('hidden');
}
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;

window.requestAppReset = () => {
    closeSettingsModal();
    customPrompt('모든 탭, 링크, 이미지와 설정을 초기화합니다. 계속하려면 "초기화"를 입력하세요.', '', async value => {
        if (value.trim() !== '초기화') return customAlert('확인 문구가 일치하지 않아 초기화하지 않았습니다.');
        try {
            await memoService.clearImages(currentUser?.uid);
            categories = [...DEFAULT_CATEGORIES];
            linkData = createDefaultLinkData(categories);
            activeTab = categories[0];
            uiPreferences = createDefaultPreferences(activeTab);
            applyPreferences();
            await saveData();
            showHome();
            customAlert('전체 데이터가 초기화되었습니다.');
        } catch (error) {
            customAlert('초기화 중 오류가 발생했습니다.');
        }
    });
};

function getReauthMode(user) {
    if (user.isAnonymous) return 'none';
    const providerIds = user.providerData.map(provider => provider.providerId);
    if (providerIds.includes('google.com')) return 'google';
    if (providerIds.includes('password')) return 'password';
    return 'none';
}

window.openAccountDeleteModal = () => {
    closeSettingsModal();
    deleteReauthMode = getReauthMode(currentUser);
    accountDeletePhrase.value = '';
    accountDeletePassword.value = '';
    accountDeleteStatus.textContent = deleteReauthMode === 'google' ? '계속하면 Google 재인증 창이 열립니다.' : '';
    accountDeletePasswordWrap.classList.toggle('hidden', deleteReauthMode !== 'password');
    accountDeleteConfirmBtn.disabled = false;
    accountDeleteConfirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    accountDeleteModal.classList.remove('hidden');
    accountDeletePhrase.focus();
};

function closeAccountDeleteModal() {
    if (isDeletingAccount) return;
    accountDeleteModal.classList.add('hidden');
    accountDeleteStatus.textContent = '';
}
window.closeAccountDeleteModal = closeAccountDeleteModal;

window.confirmAccountDeletion = async () => {
    const user = auth?.currentUser;
    if (!user || isDeletingAccount) return;
    if (accountDeletePhrase.value.trim() !== '회원 탈퇴') {
        accountDeleteStatus.textContent = '확인 문구가 일치하지 않습니다.';
        return;
    }
    if (deleteReauthMode === 'password' && !accountDeletePassword.value) {
        accountDeleteStatus.textContent = '현재 비밀번호를 입력해주세요.';
        return;
    }

    accountDeleteConfirmBtn.disabled = true;
    accountDeleteConfirmBtn.classList.add('opacity-60', 'cursor-not-allowed');
    accountDeleteStatus.textContent = '본인 확인 중입니다.';
    let dataDeleted = false;
    try {
        if (deleteReauthMode === 'google') {
            await reauthenticateWithPopup(user, new GoogleAuthProvider());
        } else if (deleteReauthMode === 'password') {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, accountDeletePassword.value));
        }

        isDeletingAccount = true;
        accountDeleteStatus.textContent = '계정과 데이터를 삭제하는 중입니다.';
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        unsubscribeSnapshot = null;
        await memoRepository.delete(user.uid);
        dataDeleted = true;
        await memoService.clearImages(user.uid);
        await deleteUser(user);
        isDeletingAccount = false;
        accountDeleteModal.classList.add('hidden');
        document.body.classList.remove('theme-dark');
        showLogin();
    } catch (error) {
        isDeletingAccount = false;
        accountDeleteConfirmBtn.disabled = false;
        accountDeleteConfirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            accountDeleteStatus.textContent = '비밀번호가 올바르지 않습니다.';
        } else if (error.code === 'auth/popup-closed-by-user') {
            accountDeleteStatus.textContent = 'Google 재인증이 취소되었습니다.';
        } else if (error.code === 'auth/requires-recent-login') {
            accountDeleteStatus.textContent = '다시 로그인한 뒤 회원 탈퇴를 시도해주세요.';
        } else if (dataDeleted) {
            accountDeleteStatus.textContent = '데이터는 삭제됐지만 계정 삭제가 완료되지 않았습니다. 다시 시도해주세요.';
        } else {
            accountDeleteStatus.textContent = '회원 탈퇴 처리에 실패했습니다. 다시 시도해주세요.';
        }
        if (!dataDeleted && currentUser && !unsubscribeSnapshot) loadDataFromFirestore();
    }
};

darkModeToggle.addEventListener('change', async event => {
    uiPreferences.darkMode = event.target.checked;
    applyPreferences();
    await savePreferences();
});

document.querySelectorAll('input[name="folderColumns"]').forEach(input => {
    input.addEventListener('change', async event => {
        const columns = Number(event.target.value);
        if (!VALID_COLUMNS.includes(columns)) return;
        uiPreferences.folderColumns = columns;
        applyPreferences();
        renderHomeLanding();
        await savePreferences();
    });
});

document.addEventListener('click', event => {
    if (!event.target.closest('.tab-menu-button') && !event.target.closest('.tab-menu-panel')) {
        document.querySelectorAll('.tab-menu-panel').forEach(panel => panel.classList.add('hidden'));
        document.querySelectorAll('.tab-menu-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
});

imagePreviewModal.addEventListener('click', event => { if (event.target === imagePreviewModal) hideImagePreview(); });
settingsModal.addEventListener('click', event => { if (event.target === settingsModal) closeSettingsModal(); });
accountDeleteModal.addEventListener('click', event => { if (event.target === accountDeleteModal) closeAccountDeleteModal(); });
linkEditModal.addEventListener('click', event => { if (event.target === linkEditModal) window.closeLinkEditModal(); });

document.addEventListener('keydown', event => {
    if (!imagePreviewModal.classList.contains('hidden') && event.key === 'ArrowLeft') {
        event.preventDefault();
        moveCarousel(-1);
        return;
    }
    if (!imagePreviewModal.classList.contains('hidden') && event.key === 'ArrowRight') {
        event.preventDefault();
        moveCarousel(1);
        return;
    }
    if (event.key !== 'Escape') return;
    activeTabActionController?.cancel();
    document.querySelectorAll('.tab-menu-panel').forEach(panel => panel.classList.add('hidden'));
    hideImagePreview();
    closeSettingsModal();
    closeAccountDeleteModal();
    window.closeLinkEditModal();
    window.closeLinkAccountModal();
});