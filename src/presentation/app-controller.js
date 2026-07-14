import {
    signInWithCustomToken, signInAnonymously, onAuthStateChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    GoogleAuthProvider, signInWithPopup, EmailAuthProvider, linkWithCredential,
    linkWithPopup, reauthenticateWithCredential, reauthenticateWithPopup,
    deleteUser, auth, hasFirebaseConfig
} from "../infrastructure/firebase/auth-gateway.js";
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";
import { createMemoService } from "../application/memos/memo-service.js";
import { createFirestoreMemoRepository } from "../infrastructure/firestore/memo-repository.js";
import { getMemoPreviewKind, isCommentOnlyMemo, normalizeHttpUrl, normalizeMemoInput } from "../domain/memos/memo-policy.js";
import { createModalController } from "./components/modal.js";
import { createHoldActions } from "./interactions/hold-actions.js";
import { createDefaultDriveConnection, canUseDrive, normalizeDriveConnection } from "../domain/drive/drive-connection.js";
import { createGoogleDriveCodeProvider } from "../infrastructure/google/google-drive-code-provider.js";
import { createDriveWorkerImageRepository } from "../infrastructure/http/drive-worker-image-repository.js";
import { createDriveImageService } from "../application/drive/drive-image-service.js";

const memoRepository = createFirestoreMemoRepository();
const memoService = createMemoService({ imageRepository });
const driveCodeProvider = createGoogleDriveCodeProvider();
const driveImageRepository = createDriveWorkerImageRepository({ auth });
const driveImageService = createDriveImageService({
    localImageRepository: imageRepository,
    driveImageRepository,
    driveCodeProvider
});

const DEFAULT_CATEGORIES = ['업무', '학습', '개인', '도구', '기타'];
const DEFAULT_COLUMNS = 3;
const VALID_COLUMNS = [3, 4, 5, 6];

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
const driveSyncStatus = document.getElementById('driveSyncStatus');

let currentUser = null;
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
let isDeletingAccount = false;
let selectedImageFile = null;
let previewObjectUrl = null;
let modalObjectUrl = null;
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

async function savePreferences() {
    if (!currentUser) return;
    try {
        await memoRepository.savePreferences(currentUser.uid, uiPreferences);
    } catch (error) {
        customAlert('설정을 클라우드에 저장하지 못했습니다.');
    }
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
    button.className = 'folder-button bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md rounded-lg p-5 text-left transition-all flex flex-col justify-between';
    button.innerHTML = `<span class="folder-icon-shell rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center mb-4"><i class="fa-solid ${icon} ${color} text-4xl"></i></span><span class="folder-title text-lg font-bold text-gray-800 truncate w-full">${escapeHtml(label)}</span><span class="folder-subtitle text-sm text-gray-500 mt-1 truncate w-full">${escapeHtml(subtitle)}</span>`;
    button.onclick = onClick;
    return button;
}

function renderHomeLanding() {
    const fixedFolderGrid = document.getElementById('fixedFolderGrid');
    if (!fixedFolderGrid || !categoryFolderGrid) return;
    const recentTab = categories.includes(uiPreferences.lastViewedTab) ? uiPreferences.lastViewedTab : (categories[0] || '');
    uiPreferences.lastViewedTab = recentTab;

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
}

if (auth) {
    onAuthStateChanged(auth, user => {
        if (user) {
            currentUser = user;
            updateHeaderUI(user);
            loadDataFromFirestore();
            return;
        }
        currentUser = null;
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        unsubscribeSnapshot = null;
        categories = [...DEFAULT_CATEGORIES];
        activeTab = categories[0];
        linkData = {};
        uiPreferences = createDefaultPreferences(activeTab);
        driveConnection = createDefaultDriveConnection();
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
        DRIVE_OFFLINE_ACCESS_REQUIRED: '기존 Google 권한에서 장기 연결 정보를 받지 못했습니다. Google 계정의 Link Memo 권한을 제거한 뒤 다시 연결해주세요.',
        GOOGLE_TOKEN_EXCHANGE_FAILED: 'Google 권한 코드를 교환하지 못했습니다. OAuth Client ID와 Secret 설정을 확인해주세요.',
        TOKEN_ENCRYPTION_KEY_INVALID: 'Drive 보안 저장소 암호화 설정이 올바르지 않습니다.',
        DRIVE_NOT_CONNECTED: 'Drive 연결 정보가 없습니다. Drive 연결을 다시 시도해주세요.',
        DRIVE_TOKEN_REFRESH_FAILED: 'Drive 연결이 만료되었습니다. Drive 연결을 다시 시도해주세요.'
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
    selectedImageFile = null;
    imageInput.value = '';
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    imagePreview.classList.add('hidden');
    imagePreviewName.textContent = '';
}

imageInput.addEventListener('change', () => {
    selectedImageFile = imageInput.files?.[0] || null;
    if (!selectedImageFile) return resetSelectedImage();
    if (!selectedImageFile.type.startsWith('image/')) {
        customAlert('이미지 파일만 첨부할 수 있습니다.');
        return resetSelectedImage();
    }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(selectedImageFile);
    imagePreviewName.textContent = selectedImageFile.name;
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

    unsubscribeSnapshot = memoRepository.subscribe(currentUser.uid, snapshot => {
        if (isDeletingAccount) return;
        if (snapshot.exists()) {
            const data = snapshot.data();
            categories = Array.isArray(data.categories) ? data.categories : [...DEFAULT_CATEGORIES];
            linkData = data.linkData && typeof data.linkData === 'object' ? data.linkData : {};
            uiPreferences = data.uiPreferences || createDefaultPreferences(categories[0]);
            driveConnection = normalizeDriveConnection(data.driveConnection);
        } else {
            categories = [...DEFAULT_CATEGORIES];
            linkData = createDefaultLinkData(categories);
            uiPreferences = createDefaultPreferences(categories[0]);
            driveConnection = createDefaultDriveConnection();
        }

        const modified = migrateDataFormat();
        activeTab = categories.includes(uiPreferences.lastViewedTab) ? uiPreferences.lastViewedTab : categories[0];
        applyPreferences();
        if (modified || !snapshot.exists()) saveData();
        if (canUseDrive(driveConnection)) void driveImageService.restoreSession(driveConnection);

        if (document.body.classList.contains('is-dragging') || document.body.classList.contains('is-tab-dragging') || document.body.classList.contains('is-subcategory-dragging')) return;
        if (isFirstLoad) {
            isFirstLoad = false;
            showHome();
            void requestInitialDrivePermission();
        } else if (!mainApp.classList.contains('hidden')) {
            initApp();
        } else {
            renderHomeLanding();
        }
    }, error => {
        console.error('Firestore read error:', error);
        customAlert('저장 데이터를 불러오지 못했습니다.');
    });
}

async function saveData() {
    if (!currentUser || isDeletingAccount) return;
    try {
        await memoRepository.save(currentUser.uid, { categories, linkData, uiPreferences, driveConnection });
    } catch (error) {
        customAlert('클라우드 저장에 실패했습니다.');
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
        createRoundActionButton('fa-regular fa-image', item.imageId ? '이미지 교체' : '이미지 추가', event => { event.preventDefault(); event.stopPropagation(); window.editLinkImage(subIndex, linkIndex); })
    );
    if (item.imageId) actions.appendChild(createRoundActionButton('fa-solid fa-trash-can', '이미지 제거', event => { event.preventDefault(); event.stopPropagation(); window.removeLinkImage(subIndex, linkIndex); }, 'bg-orange-100 text-orange-600'));
    actions.appendChild(createRoundActionButton('fa-solid fa-xmark', '항목 삭제', event => { event.preventDefault(); event.stopPropagation(); window.deleteLink(subIndex, linkIndex); }, 'bg-red-100 text-red-500'));
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
        driveImageService.prefetchImage(item, driveConnection);
        hoverPreviewTimer = setTimeout(() => showContentPreview(item), 160);
    });
    target.addEventListener('mouseleave', clearPreviewTimers);
    target.addEventListener('focus', () => {
        driveImageService.prefetchImage(item, driveConnection);
        showContentPreview(item);
    });
    target.addEventListener('pointerdown', () => {
        driveImageService.prefetchImage(item, driveConnection);
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

async function showContentPreview(item) {
    clearPreviewTimers();
    const kind = getMemoPreviewKind(item);
    if (kind === 'none') return;
    const requestId = ++previewRequestId;
    const hasText = kind === 'text' || kind === 'combined';
    const imageRecord = await driveImageService.loadImage(item, driveConnection);
    if (imageRecord?.driveMissing) void repairMissingDriveImage(item);
    if (requestId !== previewRequestId) return;
    const hasImage = Boolean(imageRecord?.blob);
    if (!hasText && !hasImage) return;

    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = hasImage ? URL.createObjectURL(imageRecord.blob) : null;
    imagePreviewModalTitle.textContent = item.text || '미리보기';
    previewTextContent.textContent = hasText ? item.comment : '';
    previewTextTab.classList.toggle('hidden', !hasText);
    previewImageTab.classList.toggle('hidden', !hasImage);
    previewTabs.classList.toggle('hidden', !(hasText && hasImage));
    if (hasImage) imagePreviewModalImg.src = modalObjectUrl;
    else imagePreviewModalImg.removeAttribute('src');
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
    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = null;
}
window.hideImagePreview = hideImagePreview;
previewTextTab.onclick = () => setPreviewMode('text');
previewImageTab.onclick = () => setPreviewMode('image');

window.handleKeyPress = event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        window.saveLink();
    }
};

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
        hasImage: Boolean(selectedImageFile)
    });

    if (!Number.isInteger(subIndex) || !linkData[activeTab]?.[subIndex]) return customAlert('저장할 소분류를 먼저 추가해주세요.');
    if (!result.ok) return customAlert(result.error);
    const { text, url, comment } = result.value;

    let imageId = null;
    let driveImage = null;
    if (selectedImageFile) {
        if (!canUseDrive(driveConnection)) warnLocalOnlyImageStorage();
        try {
            imageId = await saveImageFile(selectedImageFile);
            if (canUseDrive(driveConnection)) {
                try {
                    driveImage = await saveDriveImage(selectedImageFile);
                } catch (error) {
                    console.error('Drive 이미지 업로드 실패:', error);
                    customAlert('Google Drive 업로드에 실패해 현재 기기에만 이미지를 저장했습니다.');
                }
            }
        } catch (error) {
            if (!url && !comment.trim()) return customAlert('이미지 저장에 실패했습니다. 다시 시도해주세요.');
            customAlert('이미지 저장에 실패해 입력 가능한 내용만 저장합니다.');
        }
    }

    linkData[activeTab][subIndex].links.push({ id: createId('link'), text, url, comment, imageId, driveImage, createdAt: Date.now(), updatedAt: Date.now() });
    await saveData();
    renderLinks();
    renderHomeLanding();
    textInput.value = '';
    urlInput.value = '';
    commentInput.value = '';
    resetSelectedImage();
    textInput.focus();
};
window.deleteLink = (subIndex, linkIndex) => {
    customConfirm('이 항목을 삭제하시겠습니까?', async () => {
        const [removed] = linkData[activeTab][subIndex].links.splice(linkIndex, 1);
        await memoService.deleteImage(removed?.imageId);
        await driveImageService.removeDriveImage(removed?.driveImage);
        await saveData();
        renderLinks();
        renderHomeLanding();
    });
};

window.editLinkText = (subIndex, linkIndex) => {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    customPrompt('버튼 텍스트를 수정하세요.', link.text || '', async value => {
        const text = value.trim();
        if (!text) return customAlert('버튼 텍스트는 비워둘 수 없습니다.');
        link.text = text;
        link.updatedAt = Date.now();
        await saveData();
        renderLinks();
    });
};

window.editLinkComment = (subIndex, linkIndex) => {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    customPrompt('코멘트를 입력하세요.', link.comment || '', async value => {
        if (!value.trim() && !link.url && !link.imageId) return customAlert('링크, 이미지 또는 코멘트 중 하나는 유지해야 합니다.');
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
    picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return customAlert('이미지 파일만 첨부할 수 있습니다.');
        const link = linkData[activeTab][subIndex].links[linkIndex];
        try {
            if (!canUseDrive(driveConnection)) warnLocalOnlyImageStorage();
            link.imageId = await saveImageFile(file, link.imageId || null);
            if (canUseDrive(driveConnection)) {
                await driveImageService.removeDriveImage(link.driveImage);
                link.driveImage = await saveDriveImage(file);
            }
            link.updatedAt = Date.now();
            await saveData();
            renderLinks();
        } catch (error) {
            customAlert('이미지 저장에 실패했습니다.');
        }
    };
    picker.click();
};

window.removeLinkImage = (subIndex, linkIndex) => {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    if (!link.imageId) return;
    if (!link.url && !link.comment?.trim()) return customAlert('링크나 코멘트가 없는 이미지 전용 항목에서는 이미지를 제거할 수 없습니다.');
    customConfirm('첨부 이미지를 제거하시겠습니까?', async () => {
        await memoService.deleteImage(link.imageId);
        await driveImageService.removeDriveImage(link.driveImage);
        delete link.imageId;
        delete link.driveImage;
        link.updatedAt = Date.now();
        await saveData();
        renderLinks();
    });
};

function openSettingsModal() {
    applyPreferences();
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

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    activeTabActionController?.cancel();
    document.querySelectorAll('.tab-menu-panel').forEach(panel => panel.classList.add('hidden'));
    hideImagePreview();
    closeSettingsModal();
    closeAccountDeleteModal();
    window.closeLinkAccountModal();
});