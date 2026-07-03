import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, EmailAuthProvider, linkWithCredential, linkWithPopup } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const modal = document.getElementById('customModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalInput = document.getElementById('modalInput');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
let currentModalCallback = null;

function openModal({ type, title, message, defaultValue = '', onConfirm = null }) {
    modalTitle.textContent = title;
    modalMessage.innerHTML = message;
    currentModalCallback = onConfirm;
    modalInput.value = defaultValue;
    modalInput.classList.add('hidden');
    modalCancelBtn.classList.add('hidden');
    modalInput.onkeydown = null;

    if (type === 'prompt') {
        modalInput.classList.remove('hidden');
        modalCancelBtn.classList.remove('hidden');
        modalInput.style.height = 'auto';
        setTimeout(() => {
            modalInput.style.height = modalInput.scrollHeight + 'px';
            modalInput.focus();
        }, 50);
        modalInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                confirmModal();
            }
        };
    } else if (type === 'confirm') {
        modalCancelBtn.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
}

modalInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

function closeModal() {
    modal.classList.add('hidden');
    currentModalCallback = null;
}

function confirmModal() {
    const val = modalInput.value;
    const cb = currentModalCallback;
    closeModal();
    if (cb) cb(val);
}

modalConfirmBtn.onclick = confirmModal;
modalCancelBtn.onclick = closeModal;

function customAlert(msg) { openModal({ type: 'alert', title: '알림', message: msg }); }
function customConfirm(msg, onConfirm) { openModal({ type: 'confirm', title: '확인', message: msg, onConfirm: () => onConfirm() }); }
function customPrompt(msg, defaultValue, onConfirm) { openModal({ type: 'prompt', title: '입력', message: msg, defaultValue, onConfirm }); }

window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.customPrompt = customPrompt;

const firebaseConfig = {
    apiKey: "AIzaSyBJFs1rgUPZqjwZt2wgNuKBXH3uxDpZFXc",
    authDomain: "link-note-c8c1d.firebaseapp.com",
    projectId: "link-note-c8c1d",
    storageBucket: "link-note-c8c1d.firebasestorage.app",
    messagingSenderId: "993879795668",
    appId: "1:993879795668:web:f1401e2c4da1c6cc50d841",
    measurementId: "G-C468ZCLCWH"
};

try {
    firebaseConfig.apiKey = import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey;
    firebaseConfig.authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain;
    firebaseConfig.projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId;
    firebaseConfig.storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket;
    firebaseConfig.messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId;
    firebaseConfig.appId = import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId;
    firebaseConfig.measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId;
} catch (e) {
    console.warn('Vite 환경 변수를 사용할 수 없어 기본/폴백 설정을 시도합니다.');
}

let configToUse = firebaseConfig;
if (typeof __firebase_config !== 'undefined') {
    const parsedConfig = JSON.parse(__firebase_config);
    if (Object.keys(parsedConfig).length > 0) configToUse = parsedConfig;
}

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

if (!configToUse || !configToUse.apiKey) {
    console.error('Firebase Configuration is missing or empty.');
    loginScreen.classList.remove('hidden');
    loginScreen.classList.add('flex');
    setTimeout(() => {
        customAlert(`
            <div class="text-center">
                <i class="fa-solid fa-triangle-exclamation text-yellow-500 text-3xl mb-2"></i><br>
                <b class="text-lg">Firebase 설정 누락 안내</b><br>
                <span class="text-sm text-red-500 font-semibold">API Key 값이 감지되지 않았습니다.</span>
            </div>
            <div class="mt-4 text-xs text-gray-600 bg-gray-50 p-3 rounded text-left leading-relaxed">
                <b>해결 방법:</b><br>
                1. 깃허브 Repository의 <b>Settings > Secrets and variables > Actions</b>에 시크릿 변수(API Key 등)가 제대로 등록되어 있는지 체크해 주세요.<br><br>
                2. 깃허브 Pages 배포 소스가 <b>GitHub Actions</b> 방식으로 빌드 및 발행되는지 저장소 Pages 설정 탭을 점검해 보세요.
            </div>
        `);
    }, 600);
}

const app = (configToUse && configToUse.apiKey) ? initializeApp(configToUse) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-github-memo-app';

let currentUser = null;
let unsubscribeSnapshot = null;
let categories = ['업무', '학습', '개인', '도구', '기타'];
let activeTab = categories[0];
let linkData = {};
let draggedItem = null;
let draggedTab = null;
let draggedSubcategoryIndex = null;
let isFirstLoad = true;
let selectedImageFile = null;
let previewObjectUrl = null;
let modalObjectUrl = null;
let hoverPreviewTimer = null;
let longPressTimer = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
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
    renderHomeLanding();
}

function showMain(category = activeTab) {
    if (category && categories.includes(category)) activeTab = category;
    loginScreen.classList.add('hidden');
    loginScreen.classList.remove('flex');
    homeLanding.classList.add('hidden');
    mainApp.classList.remove('hidden');
    initApp();
}

window.showHome = showHome;
window.showMain = showMain;

function updateHeaderUI(user) {
    const isGuest = user.isAnonymous || !user.email;
    const userIdentifier = isGuest ? '게스트 사용자' : user.email;
    const linkBtnHtml = isGuest ?
        `<button onclick="window.openLinkAccountModal()" class="text-xs bg-green-100 text-green-700 hover:bg-green-600 hover:text-white px-3 py-1.5 rounded transition-colors font-semibold shadow-sm mr-2 border border-green-200">
            <i class="fa-solid fa-link mr-1"></i>계정 연동
         </button>` : '';
    const html = `
        <i class="fa-solid fa-user-circle text-blue-500 mr-2 text-lg"></i>
        <span class="mr-3 text-gray-700 font-bold truncate max-w-[11rem]">${escapeHtml(userIdentifier)}</span>
        ${linkBtnHtml}
        <button onclick="window.handleLogout()" class="text-xs bg-red-100 text-red-600 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded transition-colors font-semibold shadow-sm border border-red-200">로그아웃</button>
    `;
    userInfoDisplay.innerHTML = html;
    homeUserInfoDisplay.innerHTML = html;
}

function getAllLinks() {
    return categories.flatMap(category => (linkData[category] || []).flatMap(sub => (sub.links || []).map(link => ({ ...link, category }))));
}

function renderHomeLanding() {
    const fixedFolderGrid = document.getElementById('fixedFolderGrid');
    const categoryFolderGrid = document.getElementById('categoryFolderGrid');
    if (!fixedFolderGrid || !categoryFolderGrid) return;

    const newest = getAllLinks().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
    const fixedItems = [
        { label: '최근', icon: 'fa-clock-rotate-left', color: 'text-indigo-500', action: () => showMain(newest?.category || activeTab || categories[0]) },
        { label: '전체', icon: 'fa-layer-group', color: 'text-emerald-500', action: () => showMain(activeTab || categories[0]) },
        { label: '설정', icon: 'fa-gear', color: 'text-gray-500', action: () => customAlert('설정은 계정 연동과 로그아웃 메뉴를 통해 관리할 수 있습니다.') }
    ];

    fixedFolderGrid.innerHTML = '';
    fixedItems.forEach(item => fixedFolderGrid.appendChild(createFolderButton(item.label, item.icon, item.color, item.action)));

    categoryFolderGrid.innerHTML = '';
    categories.forEach(category => {
        const total = (linkData[category] || []).reduce((sum, sub) => sum + (sub.links?.length || 0), 0);
        const button = createFolderButton(category, 'fa-folder', 'text-amber-500', () => showMain(category), `${total}개 링크`);
        categoryFolderGrid.appendChild(button);
    });
}

function createFolderButton(label, icon, color, onClick, subtitle = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-button bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md rounded-xl p-5 text-left transition-all flex flex-col justify-between';
    button.innerHTML = `
        <span class="folder-icon-shell rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
            <i class="fa-solid ${icon} ${color} text-4xl"></i>
        </span>
        <span class="text-lg font-bold text-gray-800 truncate w-full">${escapeHtml(label)}</span>
        <span class="text-sm text-gray-500 mt-1">${escapeHtml(subtitle || '열기')}</span>
    `;
    button.onclick = onClick;
    return button;
}

if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            updateHeaderUI(user);
            loadDataFromFirestore();
        } else {
            currentUser = null;
            showLogin();
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
                unsubscribeSnapshot = null;
            }
            categories = ['업무', '학습', '개인', '도구', '기타'];
            activeTab = categories[0];
            linkData = {};
            isFirstLoad = true;
        }
    });
}

window.handleEmailLogin = async () => {
    if (!auth) return;
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (error) { customAlert('로그인 실패: 이메일 또는 비밀번호를 확인해주세요.'); }
};

window.handleEmailRegister = async () => {
    if (!auth) return;
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try { await createUserWithEmailAndPassword(auth, email, password); customAlert('회원가입이 완료되었습니다!'); }
    catch (error) { customAlert('회원가입 실패: ' + error.message); }
};

window.handleGoogleLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); }
    catch (error) {
        let errorMsg = '로그인 처리에 실패했습니다. (' + error.code + ')';
        let solution = 'Firebase 콘솔의 <b>Authentication > Settings > 승인된 도메인</b>에 현재 사이트 주소를 추가해주세요.';
        if (error.code === 'auth/unauthorized-domain') errorMsg = '현재 실행 중인 도메인이 인증에 허용되지 않았습니다.';
        if (error.code === 'auth/popup-closed-by-user') { errorMsg = '로그인 팝업이 닫혔습니다.'; solution = '브라우저의 팝업 차단을 해제하시거나 다시 시도해주세요.'; }
        if (error.code === 'auth/operation-not-allowed') { errorMsg = "Firebase에서 'Google 로그인'이 비활성화되어 있습니다."; solution = "Firebase 콘솔의 <b>Authentication > Sign-in method</b> 탭에서 <b>Google</b> 제공업체를 추가하고 사용 설정해주세요."; }
        customAlert(`<div class="text-center"><i class="fa-solid fa-triangle-exclamation text-yellow-500 text-3xl mb-2"></i><br><b class="text-lg">구글 로그인 실패</b><br><span class="text-xs text-red-500">${errorMsg}</span></div><div class="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded text-left leading-relaxed"><b>해결 방법:</b><br>${solution}</div>`);
    }
};

window.handleGuestLogin = async () => {
    if (!auth) return;
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            try { await signInWithCustomToken(auth, __initial_auth_token); return; }
            catch (e) { console.log('토큰 로그인 실패, 익명 로그인으로 전환합니다.'); }
        }
        await signInAnonymously(auth);
    } catch (error) {
        let errorMsg = error.message;
        let solution = '';
        if (error.code === 'auth/admin-restricted-operation' || error.code === 'auth/operation-not-allowed') {
            errorMsg = "Firebase에서 '익명 로그인'이 비활성화되어 있습니다.";
            solution = `<div class="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded text-left leading-relaxed"><b>해결 방법:</b><br>Firebase 콘솔의 <b>Authentication > Sign-in method</b> 탭에서 <b>익명(Anonymous)</b> 제공업체를 추가하고 사용 설정해주세요.</div>`;
        }
        customAlert(`<div class="text-center"><i class="fa-solid fa-triangle-exclamation text-yellow-500 text-3xl mb-2"></i><br><b class="text-lg">게스트 로그인 실패</b><br><span class="text-xs text-red-500">${errorMsg}</span></div>${solution}`);
    }
};

window.handleLogout = async () => {
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

window.closeLinkAccountModal = () => {
    document.getElementById('linkAccountModal').classList.add('hidden');
};

window.handleEmailLink = async () => {
    if (!auth || !auth.currentUser) return;
    const email = document.getElementById('linkEmailInput').value;
    const password = document.getElementById('linkPasswordInput').value;
    if (!email || !password) return customAlert('이메일과 비밀번호를 모두 입력해주세요.');
    try {
        const credential = EmailAuthProvider.credential(email, password);
        const userCred = await linkWithCredential(auth.currentUser, credential);
        customAlert('계정이 성공적으로 연동되었습니다! 이제 데이터가 안전하게 보관됩니다.');
        window.closeLinkAccountModal();
        updateHeaderUI(userCred.user);
    } catch (error) {
        customAlert(error.code === 'auth/email-already-in-use' || error.code === 'auth/credential-already-in-use' ? '이미 가입되어 있는 이메일입니다. 다른 이메일을 사용해주세요.' : '계정 연동 실패: ' + error.message);
    }
};

window.handleGoogleLink = async () => {
    if (!auth || !auth.currentUser) return;
    const provider = new GoogleAuthProvider();
    try {
        const userCred = await linkWithPopup(auth.currentUser, provider);
        customAlert('구글 계정이 성공적으로 연동되었습니다! 이제 데이터가 안전하게 보관됩니다.');
        window.closeLinkAccountModal();
        updateHeaderUI(userCred.user);
    } catch (error) {
        let errorMsg = '계정 연동 처리에 실패했습니다. (' + error.code + ')';
        if (error.code === 'auth/credential-already-in-use') errorMsg = '이미 다른 계정에 연동된 구글 계정입니다.';
        if (error.code === 'auth/popup-closed-by-user') errorMsg = '로그인 팝업이 닫혔습니다.';
        customAlert(`<b>구글 연동 실패</b><br><span class="text-xs text-red-500">${errorMsg}</span>`);
    }
};

function openImageDb() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB 미지원'));
        const request = indexedDB.open('linkMemoImages', 1);
        request.onupgradeneeded = () => {
            const dbInstance = request.result;
            if (!dbInstance.objectStoreNames.contains('images')) dbInstance.createObjectStore('images', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function imageDbTransaction(mode, handler) {
    const imageDb = await openImageDb();
    return new Promise((resolve, reject) => {
        const tx = imageDb.transaction('images', mode);
        const store = tx.objectStore('images');
        const request = handler(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => imageDb.close();
        tx.onerror = () => { imageDb.close(); reject(tx.error); };
    });
}

async function saveImageFile(file, oldImageId = null) {
    if (!file) return oldImageId || null;
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    await imageDbTransaction('readwrite', store => store.put({ id, userId: currentUser?.uid || 'guest', blob: file, name: file.name, type: file.type, createdAt: Date.now() }));
    if (oldImageId) deleteImage(oldImageId).catch(() => {});
    return id;
}

async function getImage(imageId) {
    if (!imageId) return null;
    try { return await imageDbTransaction('readonly', store => store.get(imageId)); }
    catch (error) { console.warn('이미지를 불러오지 못했습니다.', error); return null; }
}

async function deleteImage(imageId) {
    if (!imageId) return;
    try { await imageDbTransaction('readwrite', store => store.delete(imageId)); }
    catch (error) { console.warn('이미지를 삭제하지 못했습니다.', error); }
}

function resetSelectedImage() {
    selectedImageFile = null;
    if (imageInput) imageInput.value = '';
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    imagePreview?.classList.add('hidden');
    if (imagePreviewName) imagePreviewName.textContent = '';
}

imageInput?.addEventListener('change', () => {
    selectedImageFile = imageInput.files?.[0] || null;
    if (!selectedImageFile) return resetSelectedImage();
    if (!selectedImageFile.type.startsWith('image/')) {
        customAlert('이미지 파일만 첨부할 수 있습니다.');
        resetSelectedImage();
        return;
    }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(selectedImageFile);
    imagePreviewName.textContent = selectedImageFile.name;
    imagePreview.classList.remove('hidden');
});

window.clearSelectedImage = resetSelectedImage;

function migrateDataFormat() {
    let isModified = false;
    categories = categories.filter(Boolean);
    if (categories.length === 0) categories = ['업무', '학습', '개인', '도구', '기타'];

    categories.forEach(cat => {
        if (linkData[cat] && Array.isArray(linkData[cat])) {
            if (linkData[cat].length === 0 || linkData[cat][0].url !== undefined) {
                const oldLinks = linkData[cat].filter(item => item.url !== undefined).map(link => ({ ...link, createdAt: link.createdAt || Date.now(), updatedAt: link.updatedAt || Date.now() }));
                linkData[cat] = [{ id: 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2), title: '기본 분류', isOpen: true, links: oldLinks }];
                isModified = true;
            } else {
                linkData[cat].forEach(sub => {
                    if (!sub.id) { sub.id = 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2); isModified = true; }
                    if (!Array.isArray(sub.links)) { sub.links = []; isModified = true; }
                    sub.links.forEach(link => {
                        if (!link.createdAt) { link.createdAt = Date.now(); isModified = true; }
                        if (!link.updatedAt) { link.updatedAt = link.createdAt; isModified = true; }
                    });
                });
            }
        } else {
            linkData[cat] = [{ id: 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2), title: '기본 분류', isOpen: true, links: [] }];
            isModified = true;
        }
    });
    Object.keys(linkData).forEach(cat => {
        if (!categories.includes(cat)) { delete linkData[cat]; isModified = true; }
    });
    if (isModified && currentUser) saveData();
}

function loadDataFromFirestore() {
    if (!currentUser || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'memoData', 'main');
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            categories = data.categories || ['업무', '학습', '개인', '도구', '기타'];
            linkData = data.linkData || {};
            if (!categories.includes(activeTab)) activeTab = categories[0] || '';
        } else {
            categories = ['업무', '학습', '개인', '도구', '기타'];
            activeTab = categories[0];
            linkData = {};
            categories.forEach(cat => { linkData[cat] = []; });
        }

        migrateDataFormat();

        if (!document.body.classList.contains('is-dragging') && !document.body.classList.contains('is-tab-dragging') && !document.body.classList.contains('is-subcategory-dragging')) {
            if (isFirstLoad) {
                showHome();
                isFirstLoad = false;
            } else if (!mainApp.classList.contains('hidden')) {
                initApp();
            } else {
                renderHomeLanding();
            }
        }
    }, (error) => console.error('Firestore read error:', error));
}

async function saveData() {
    if (!currentUser || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'memoData', 'main');
    try { await setDoc(docRef, { categories, linkData }); }
    catch (error) { customAlert('클라우드 저장에 실패했습니다.'); }
}

function initApp() {
    renderTabs();
    renderSubCategorySelect();
    renderLinks();
}

function renderTabs() {
    const tabsContainer = document.getElementById('tabsContainer');
    tabsContainer.innerHTML = '';

    const menuWrap = document.createElement('div');
    menuWrap.className = 'relative shrink-0';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'tab-menu-button flex items-center px-4 py-3 text-gray-600 hover:text-blue-600 hover:bg-gray-50 border-b-2 border-transparent';
    menuButton.innerHTML = '<i class="fa-solid fa-bars text-lg"></i><span class="sr-only">전체 탭 메뉴</span>';
    const menuPanel = document.createElement('div');
    menuPanel.className = 'tab-menu-panel hidden absolute left-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-30 py-2';
    menuButton.onclick = (e) => { e.stopPropagation(); menuPanel.classList.toggle('hidden'); };
    categories.forEach(category => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:text-blue-600 ${category === activeTab ? 'font-bold text-blue-600 bg-blue-50' : 'text-gray-700'}`;
        item.textContent = category;
        item.onclick = () => { menuPanel.classList.add('hidden'); switchTab(category); };
        menuPanel.appendChild(item);
    });
    menuWrap.appendChild(menuButton);
    menuWrap.appendChild(menuPanel);
    tabsContainer.appendChild(menuWrap);

    categories.forEach(category => {
        const isActive = category === activeTab;
        const tabButton = document.createElement('div');
        tabButton.className = `tab-button group flex items-center px-5 py-3 font-medium text-sm transition-colors duration-200 cursor-pointer ${isActive ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-b-2 border-transparent'}`;
        tabButton.draggable = true;
        tabButton.dataset.category = category;
        tabButton.onclick = () => switchTab(category);
        tabButton.addEventListener('dragstart', (e) => {
            draggedTab = category;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', category);
            document.body.classList.add('is-tab-dragging');
            setTimeout(() => tabButton.classList.add('is-dragging'), 0);
        });
        tabButton.addEventListener('dragend', () => {
            document.body.classList.remove('is-tab-dragging');
            draggedTab = null;
            document.querySelectorAll('.tab-button').forEach(tab => tab.classList.remove('drag-over', 'is-dragging'));
        });
        tabButton.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        tabButton.addEventListener('dragenter', () => { if (draggedTab && draggedTab !== category) tabButton.classList.add('drag-over'); });
        tabButton.addEventListener('dragleave', () => tabButton.classList.remove('drag-over'));
        tabButton.addEventListener('drop', (e) => {
            e.preventDefault();
            tabButton.classList.remove('drag-over');
            if (!draggedTab || draggedTab === category) return;
            const from = categories.indexOf(draggedTab);
            const to = categories.indexOf(category);
            const [moved] = categories.splice(from, 1);
            categories.splice(to, 0, moved);
            saveData();
            renderTabs();
            renderHomeLanding();
        });

        const span = document.createElement('span');
        span.textContent = category;
        tabButton.appendChild(span);

        if (isActive) {
            const editBtn = document.createElement('button');
            editBtn.className = 'ml-2 text-gray-400 hover:text-blue-600 focus:outline-none';
            editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square text-xs"></i>';
            editBtn.onclick = (e) => { e.stopPropagation(); window.editMainCategory(category); };
            tabButton.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'ml-1 text-gray-400 hover:text-red-500 focus:outline-none';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can text-xs"></i>';
            deleteBtn.onclick = (e) => { e.stopPropagation(); window.deleteMainCategory(category); };
            tabButton.appendChild(deleteBtn);
        }
        tabsContainer.appendChild(tabButton);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'flex items-center px-4 py-3 font-medium text-sm text-gray-400 hover:text-blue-600 transition-colors duration-200 focus:outline-none border-b-2 border-transparent';
    addBtn.innerHTML = '<i class="fa-solid fa-plus mr-1"></i>추가';
    addBtn.onclick = window.addMainCategory;
    tabsContainer.appendChild(addBtn);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-menu-button') && !e.target.closest('.tab-menu-panel')) {
        document.querySelectorAll('.tab-menu-panel').forEach(panel => panel.classList.add('hidden'));
    }
});

function switchTab(category) {
    activeTab = category;
    initApp();
}

window.addMainCategory = () => {
    customPrompt('새 카테고리 이름을 입력하세요:', '', (newCat) => {
        if (newCat && newCat.trim() !== '') {
            const trimmedName = newCat.trim();
            if (categories.includes(trimmedName)) return customAlert('이미 존재하는 카테고리입니다.');
            categories.push(trimmedName);
            linkData[trimmedName] = [{ id: 'sub_' + Date.now().toString(36), title: '기본 분류', isOpen: true, links: [] }];
            activeTab = trimmedName;
            saveData();
            switchTab(trimmedName);
        }
    });
};

window.editMainCategory = (oldCat) => {
    customPrompt(`'${escapeHtml(oldCat)}' 카테고리의 새 이름을 입력하세요:`, oldCat, (newCat) => {
        if (newCat && newCat.trim() !== '' && newCat.trim() !== oldCat) {
            const trimmedName = newCat.trim();
            if (categories.includes(trimmedName)) return customAlert('이미 존재하는 카테고리입니다.');
            const index = categories.indexOf(oldCat);
            categories[index] = trimmedName;
            linkData[trimmedName] = linkData[oldCat];
            delete linkData[oldCat];
            if (activeTab === oldCat) activeTab = trimmedName;
            saveData();
            switchTab(activeTab);
        }
    });
};

window.deleteMainCategory = (catName) => {
    if (categories.length <= 1) return customAlert('최소 1개의 카테고리는 유지해야 합니다.');
    customConfirm(`'${escapeHtml(catName)}' 카테고리를 삭제하시겠습니까?<br><span class="text-xs text-red-500 font-normal mt-1 block">(포함된 모든 데이터가 삭제됩니다)</span>`, () => {
        categories = categories.filter(c => c !== catName);
        delete linkData[catName];
        if (activeTab === catName) activeTab = categories[0];
        saveData();
        switchTab(activeTab);
    });
};

function renderSubCategorySelect() {
    const select = document.getElementById('subCategorySelect');
    select.innerHTML = '';
    const currentSubs = linkData[activeTab] || [];
    document.getElementById('currentTabLabel').textContent = `${activeTab} 내역`;

    if (currentSubs.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '소분류를 추가해주세요';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }
    currentSubs.forEach((sub, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = sub.title;
        select.appendChild(opt);
    });
}

window.addSubcategory = () => {
    customPrompt('새로운 소분류 이름을 입력하세요:', '', (newName) => {
        if (newName && newName.trim() !== '') {
            if (!linkData[activeTab]) linkData[activeTab] = [];
            linkData[activeTab].push({ id: 'sub_' + Date.now(), title: newName.trim(), isOpen: true, links: [] });
            saveData();
            initApp();
        }
    });
};

window.editSubcategory = (subIndex, oldName) => {
    customPrompt(`'${escapeHtml(oldName)}' 소분류의 새 이름을 입력하세요:`, oldName, (newName) => {
        if (newName && newName.trim() !== '' && newName.trim() !== oldName) {
            linkData[activeTab][subIndex].title = newName.trim();
            saveData();
            initApp();
        }
    });
};

window.deleteSubcategory = (subIndex, name) => {
    customConfirm(`'${escapeHtml(name)}' 소분류를 삭제하시겠습니까?<br><span class="text-xs text-red-500 font-normal mt-1 block">(포함된 링크도 모두 삭제됩니다)</span>`, () => {
        const removed = linkData[activeTab].splice(subIndex, 1)[0];
        (removed?.links || []).forEach(link => deleteImage(link.imageId));
        if (linkData[activeTab].length === 0) linkData[activeTab].push({ id: 'sub_' + Date.now().toString(36), title: '기본 분류', isOpen: true, links: [] });
        saveData();
        initApp();
    });
};

window.toggleSubcategory = (subIndex) => {
    const sub = linkData[activeTab][subIndex];
    sub.isOpen = !sub.isOpen;
    saveData();
    renderLinks();
};

function renderLinks() {
    const linksContainer = document.getElementById('linksContainer');
    const emptyState = document.getElementById('emptyState');
    linksContainer.innerHTML = '';
    const currentSubs = linkData[activeTab] || [];

    if (currentSubs.length === 0) {
        linksContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
        return;
    }

    linksContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');

    currentSubs.forEach((subCat, subIndex) => {
        const subWrapper = document.createElement('div');
        subWrapper.className = 'subcategory-panel bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden';
        subWrapper.dataset.subIndex = subIndex;
        subWrapper.addEventListener('dragover', (e) => { if (draggedSubcategoryIndex !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
        subWrapper.addEventListener('dragenter', () => { if (draggedSubcategoryIndex !== null && draggedSubcategoryIndex !== subIndex) subWrapper.classList.add('drag-over'); });
        subWrapper.addEventListener('dragleave', () => subWrapper.classList.remove('drag-over'));
        subWrapper.addEventListener('drop', (e) => {
            if (draggedSubcategoryIndex === null) return;
            e.preventDefault();
            subWrapper.classList.remove('drag-over');
            if (draggedSubcategoryIndex === subIndex) return;
            const [moved] = linkData[activeTab].splice(draggedSubcategoryIndex, 1);
            linkData[activeTab].splice(subIndex, 0, moved);
            saveData();
            initApp();
        });

        const header = document.createElement('div');
        header.className = `subcat-header flex justify-between items-center bg-gray-50 hover:bg-gray-100 px-4 py-3 cursor-pointer select-none transition-colors border-b ${subCat.isOpen ? 'border-gray-200' : 'border-transparent'}`;
        if (!subCat.isOpen) header.classList.add('is-closed');
        header.draggable = true;
        header.addEventListener('dragstart', (e) => {
            if (e.target.closest('button')) { e.preventDefault(); return; }
            draggedSubcategoryIndex = subIndex;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(subIndex));
            document.body.classList.add('is-subcategory-dragging');
            setTimeout(() => subWrapper.classList.add('is-dragging'), 0);
        });
        header.addEventListener('dragend', () => {
            draggedSubcategoryIndex = null;
            document.body.classList.remove('is-subcategory-dragging');
            document.querySelectorAll('.subcategory-panel').forEach(panel => panel.classList.remove('drag-over', 'is-dragging'));
        });

        const titleWrap = document.createElement('div');
        titleWrap.className = 'flex items-center flex-1';
        titleWrap.onclick = () => window.toggleSubcategory(subIndex);
        titleWrap.innerHTML = `<i class="fa-solid fa-grip-vertical text-gray-300 mr-2 text-sm"></i><i class="fa-solid fa-chevron-down text-gray-400 mr-3 text-sm"></i><h3 class="font-bold text-gray-700">${escapeHtml(subCat.title)} <span class="text-xs text-gray-400 ml-1 font-normal">(${subCat.links.length})</span></h3>`;

        const headerActions = document.createElement('div');
        headerActions.className = 'flex gap-2';
        const editSubBtn = document.createElement('button');
        editSubBtn.className = 'text-gray-400 hover:text-blue-500 p-1';
        editSubBtn.title = '수정';
        editSubBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        editSubBtn.onclick = (e) => { e.stopPropagation(); window.editSubcategory(subIndex, subCat.title); };
        const deleteSubBtn = document.createElement('button');
        deleteSubBtn.className = 'text-gray-400 hover:text-red-500 p-1';
        deleteSubBtn.title = '삭제';
        deleteSubBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        deleteSubBtn.onclick = (e) => { e.stopPropagation(); window.deleteSubcategory(subIndex, subCat.title); };
        headerActions.append(editSubBtn, deleteSubBtn);
        header.append(titleWrap, headerActions);

        const gridContainer = document.createElement('div');
        gridContainer.className = `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-4 transition-all duration-300 ${subCat.isOpen ? 'block' : 'hidden'}`;
        gridContainer.dataset.subIndex = subIndex;
        gridContainer.addEventListener('dragover', (e) => { if (draggedItem !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
        gridContainer.addEventListener('dragenter', function () { if (draggedItem !== null) this.classList.add('bg-blue-50/50'); });
        gridContainer.addEventListener('dragleave', function () { this.classList.remove('bg-blue-50/50'); });
        gridContainer.addEventListener('drop', function (e) {
            if (draggedItem === null) return;
            e.preventDefault();
            this.classList.remove('bg-blue-50/50');
            if (e.target === this) {
                const targetSubIndex = parseInt(this.dataset.subIndex, 10);
                const { subIndex: fromSub, linkIndex: fromLink } = draggedItem;
                const draggedData = linkData[activeTab][fromSub].links.splice(fromLink, 1)[0];
                linkData[activeTab][targetSubIndex].links.push(draggedData);
                saveData();
                renderLinks();
            }
        });

        if (subCat.links.length === 0) {
            const emptyNote = document.createElement('div');
            emptyNote.className = 'col-span-full text-center text-sm text-gray-400 py-2 italic pointer-events-none';
            emptyNote.textContent = '저장된 링크가 없습니다. 링크를 추가하거나 이곳으로 드래그하세요.';
            gridContainer.appendChild(emptyNote);
        }

        subCat.links.forEach((item, linkIndex) => gridContainer.appendChild(createLinkCard(item, subIndex, linkIndex)));
        subWrapper.append(header, gridContainer);
        linksContainer.appendChild(subWrapper);
    });
}

function createLinkCard(item, subIndex, linkIndex) {
    const linkCard = document.createElement('div');
    linkCard.className = 'link-card group flex flex-col gap-1.5 cursor-move h-full transition-all duration-200';
    linkCard.draggable = true;
    linkCard.dataset.subIndex = subIndex;
    linkCard.dataset.linkIndex = linkIndex;

    linkCard.addEventListener('dragstart', function (e) {
        draggedItem = { subIndex, linkIndex };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        document.body.classList.add('is-dragging');
        setTimeout(() => this.classList.add('opacity-40'), 0);
    });
    linkCard.addEventListener('dragend', function () {
        document.body.classList.remove('is-dragging');
        this.classList.remove('opacity-40');
        document.querySelectorAll('.link-card').forEach(card => card.classList.remove('ring-2', 'ring-blue-500', 'rounded-xl', 'scale-105'));
        draggedItem = null;
    });
    linkCard.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    linkCard.addEventListener('dragenter', function (e) {
        e.preventDefault();
        if (draggedItem !== null && (draggedItem.subIndex !== subIndex || draggedItem.linkIndex !== linkIndex)) this.classList.add('ring-2', 'ring-blue-500', 'rounded-xl', 'scale-105');
    });
    linkCard.addEventListener('dragleave', function () { this.classList.remove('ring-2', 'ring-blue-500', 'rounded-xl', 'scale-105'); });
    linkCard.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('ring-2', 'ring-blue-500', 'rounded-xl', 'scale-105');
        if (draggedItem !== null) {
            const targetSubIndex = parseInt(this.dataset.subIndex, 10);
            const targetLinkIndex = parseInt(this.dataset.linkIndex, 10);
            const { subIndex: fromSub, linkIndex: fromLink } = draggedItem;
            if (!(fromSub === targetSubIndex && fromLink === targetLinkIndex)) {
                const draggedData = linkData[activeTab][fromSub].links.splice(fromLink, 1)[0];
                linkData[activeTab][targetSubIndex].links.splice(targetLinkIndex, 0, draggedData);
                saveData();
                renderLinks();
            }
        }
    });

    const btnBox = document.createElement('div');
    btnBox.className = `relative bg-white border border-gray-200 group-hover:border-blue-300 rounded-lg shadow-sm group-hover:shadow-md transition-all duration-200 overflow-hidden flex items-stretch min-h-[3.5rem] w-full ${item.imageId ? 'link-has-image' : ''}`;

    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.target = '_blank';
    anchor.draggable = false;
    anchor.className = 'flex-1 flex items-center justify-center p-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50/50 transition-colors w-full overflow-hidden cursor-pointer';
    anchor.innerHTML = `<span class="font-medium truncate w-full text-center leading-tight">${escapeHtml(item.text)}</span>`;
    if (item.imageId) attachImagePreviewHandlers(anchor, item);

    const actionBtns = document.createElement('div');
    actionBtns.className = 'opacity-0 group-hover:opacity-100 absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1 transition-opacity duration-200';

    const editTextBtn = createRoundActionButton('fa-solid fa-pen', '텍스트 수정', 'hover:bg-blue-500', (e) => { e.preventDefault(); window.editLinkText(subIndex, linkIndex); });
    const editCommentBtn = createRoundActionButton('fa-regular fa-comment-dots', '코멘트 추가/수정', 'hover:bg-blue-500', (e) => { e.preventDefault(); window.editLinkComment(subIndex, linkIndex); });
    const imageBtn = createRoundActionButton('fa-regular fa-image', item.imageId ? '이미지 교체' : '이미지 추가', 'hover:bg-emerald-500', (e) => { e.preventDefault(); window.editLinkImage(subIndex, linkIndex); });
    actionBtns.append(editTextBtn, editCommentBtn, imageBtn);
    if (item.imageId) {
        const removeImageBtn = createRoundActionButton('fa-solid fa-image-slash', '이미지 제거', 'hover:bg-orange-500', (e) => { e.preventDefault(); window.removeLinkImage(subIndex, linkIndex); });
        actionBtns.appendChild(removeImageBtn);
    }
    const deleteBtn = createRoundActionButton('fa-solid fa-xmark', '삭제', 'hover:bg-red-500', (e) => { e.preventDefault(); window.deleteLink(subIndex, linkIndex); }, 'bg-red-100 text-red-500');
    actionBtns.appendChild(deleteBtn);

    btnBox.append(anchor, actionBtns);
    linkCard.appendChild(btnBox);

    if (item.comment) {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'text-xs text-gray-500 px-1.5 pb-1 break-words text-center leading-snug w-full';
        commentDiv.textContent = item.comment;
        linkCard.appendChild(commentDiv);
    }
    return linkCard;
}

function createRoundActionButton(icon, title, hoverClass, onClick, baseClass = 'bg-gray-100 text-gray-500') {
    const button = document.createElement('button');
    button.className = `w-7 h-7 rounded-full ${baseClass} ${hoverClass} hover:text-white flex items-center justify-center transition-colors shadow-sm`;
    button.innerHTML = `<i class="${icon} text-sm"></i>`;
    button.title = title;
    button.onclick = onClick;
    return button;
}

function attachImagePreviewHandlers(target, item) {
    target.addEventListener('mouseenter', () => {
        hoverPreviewTimer = setTimeout(() => showImagePreview(item), 360);
    });
    target.addEventListener('mouseleave', clearPreviewTimers);
    target.addEventListener('focus', () => showImagePreview(item));
    target.addEventListener('blur', hideImagePreview);
    target.addEventListener('pointerdown', () => {
        longPressTimer = setTimeout(() => showImagePreview(item), 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(eventName => target.addEventListener(eventName, clearPreviewTimers));
}

function clearPreviewTimers() {
    clearTimeout(hoverPreviewTimer);
    clearTimeout(longPressTimer);
}

async function showImagePreview(item) {
    clearPreviewTimers();
    const imageRecord = await getImage(item.imageId);
    if (!imageRecord?.blob) return;
    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = URL.createObjectURL(imageRecord.blob);
    imagePreviewModalTitle.textContent = item.text || '첨부 이미지';
    imagePreviewModalImg.src = modalObjectUrl;
    imagePreviewModal.classList.remove('hidden');
}

function hideImagePreview() {
    clearPreviewTimers();
    imagePreviewModal.classList.add('hidden');
    imagePreviewModalImg.removeAttribute('src');
    if (modalObjectUrl) URL.revokeObjectURL(modalObjectUrl);
    modalObjectUrl = null;
}

window.hideImagePreview = hideImagePreview;
imagePreviewModal?.addEventListener('click', (e) => { if (e.target === imagePreviewModal) hideImagePreview(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideImagePreview(); });

window.handleKeyPress = function (event) {
    if (event.key === 'Enter') window.saveLink();
};

window.saveLink = async function () {
    const selectTarget = document.getElementById('subCategorySelect');
    const textInput = document.getElementById('linkText');
    const urlInput = document.getElementById('linkUrl');
    const commentInput = document.getElementById('linkComment');
    const subIndex = selectTarget.value;
    const text = textInput.value.trim();
    let url = urlInput.value.trim();
    const comment = commentInput.value.trim();

    if (subIndex === '') return customAlert('저장할 소분류를 먼저 추가해주세요.');
    if (!text) return customAlert('버튼에 표시될 텍스트를 입력해주세요.');
    if (!url) return customAlert('연결할 링크 주소(URL)를 입력해주세요.');
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

    let imageId = null;
    if (selectedImageFile) {
        try { imageId = await saveImageFile(selectedImageFile); }
        catch (error) { customAlert('이미지 저장에 실패했습니다. 링크는 이미지 없이 저장됩니다.'); }
    }

    linkData[activeTab][subIndex].links.push({ text, url, comment, imageId, createdAt: Date.now(), updatedAt: Date.now() });
    await saveData();
    renderLinks();
    renderHomeLanding();
    textInput.value = '';
    urlInput.value = '';
    commentInput.value = '';
    resetSelectedImage();
    textInput.focus();
};

window.deleteLink = function (subIndex, linkIndex) {
    customConfirm('이 링크를 삭제하시겠습니까?', () => {
        const [removed] = linkData[activeTab][subIndex].links.splice(linkIndex, 1);
        deleteImage(removed?.imageId);
        saveData();
        renderLinks();
        renderHomeLanding();
    });
};

window.editLinkText = function (subIndex, linkIndex) {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    customPrompt('버튼 텍스트를 수정하세요:', link.text || '', (newText) => {
        if (newText !== null) {
            if (newText.trim() === '') return customAlert('버튼 텍스트는 비워둘 수 없습니다.');
            link.text = newText.trim();
            link.updatedAt = Date.now();
            saveData();
            renderLinks();
            renderHomeLanding();
        }
    });
};

window.editLinkComment = function (subIndex, linkIndex) {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    customPrompt(`'${escapeHtml(link.text)}'의 코멘트를 입력하세요:`, link.comment || '', (newComment) => {
        if (newComment !== null) {
            link.comment = newComment.trim();
            link.updatedAt = Date.now();
            saveData();
            renderLinks();
            renderHomeLanding();
        }
    });
};

window.editLinkImage = function (subIndex, linkIndex) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return customAlert('이미지 파일만 첨부할 수 있습니다.');
        const link = linkData[activeTab][subIndex].links[linkIndex];
        try {
            link.imageId = await saveImageFile(file, link.imageId || null);
            link.updatedAt = Date.now();
            await saveData();
            renderLinks();
        } catch (error) {
            customAlert('이미지 저장에 실패했습니다.');
        }
    };
    picker.click();
};

window.removeLinkImage = function (subIndex, linkIndex) {
    const link = linkData[activeTab][subIndex].links[linkIndex];
    if (!link.imageId) return;
    customConfirm('이 링크의 첨부 이미지를 제거하시겠습니까?', () => {
        deleteImage(link.imageId);
        delete link.imageId;
        link.updatedAt = Date.now();
        saveData();
        renderLinks();
    });
};
