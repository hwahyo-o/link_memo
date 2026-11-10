import { auth, onAuthStateChanged } from "../infrastructure/firebase/auth-gateway.js";
import { createVault } from "../application/pkm/vault.js";
import { createPkmSyncService } from "../application/pkm/pkm-sync-service.js";
import { createIdleSyncScheduler } from "../application/memos/idle-sync-scheduler.js";
import { createIndexedDbVaultRepository } from "../infrastructure/pkm/indexeddb-vault-repository.js";
import { createFirestoreVaultRepository } from "../infrastructure/pkm/firestore-vault-repository.js";
import { createVaultSecondBrainItemRepository } from "../infrastructure/second-brain/vault-item-repository.js";
import { createIndexedDbAttachmentQueue } from "../infrastructure/second-brain/indexeddb-attachment-queue.js";
import { createDriveWorkerDocumentRepository } from "../infrastructure/http/drive-worker-document-repository.js";
import { createDriveWorkerImageRepository } from "../infrastructure/http/drive-worker-image-repository.js";
import { createDriveImageService } from "../application/drive/drive-image-service.js";
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";
import { createGoogleDriveCodeProvider } from "../infrastructure/google/google-drive-code-provider.js";

const byId = id => document.getElementById(id);
const vault = createVault();
const localVaultRepository = createIndexedDbVaultRepository();
const remoteVaultRepository = createFirestoreVaultRepository();
const attachmentQueue = createIndexedDbAttachmentQueue();
const driveCodeProvider = createGoogleDriveCodeProvider();
const driveImageRepository = createDriveWorkerImageRepository({ auth });
const driveImageService = createDriveImageService({
    localImageRepository: imageRepository,
    driveImageRepository,
    driveCodeProvider
});
const documentRepository = createDriveWorkerDocumentRepository({
    auth,
    queue: attachmentQueue,
    driveCodeProvider
});

let currentUser = null;
let sessionId = 0;
let itemRepository = null;
let currentView = "inbox";
let selectedId = null;
let driveConnected = false;
let driveConnection = null;

const pkmSync = createPkmSyncService({
    localRepository: localVaultRepository,
    remoteRepository: remoteVaultRepository,
    scheduler: createIdleSyncScheduler({ delay: 3 * 60 * 1000 }),
    onSynced(snapshot, userId) {
        if (auth?.currentUser?.uid !== userId || currentUser?.uid !== userId) return;
        vault.replace(snapshot);
        setSyncStatus("동기화 완료");
        void renderItems();
    }
});

function setSyncStatus(label, state = "idle") {
    const status = byId("syncStatus");
    status.textContent = label;
    status.dataset.state = state;
}

function setNotice(message, state = "") {
    const notice = byId("notice");
    notice.textContent = message || "";
    notice.dataset.state = state;
}

function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value || Date.now()));
}

function kindLabel(kind) {
    return ({ note: "메모", link: "링크", document: "문서", daily: "일일 기록", image: "이미지", canvas: "캔버스", structured: "자료" })[kind] || "자료";
}

function setCaptureKind(kind) {
    byId("sourceUrlField").classList.toggle("hidden", kind !== "link");
    byId("documentFileField").classList.toggle("hidden", kind !== "document");
    byId("imageFileField").classList.toggle("hidden", kind !== "image");
    byId("sourceUrl").required = kind === "link";
}

function resetCapture() {
    byId("captureForm").reset();
    byId("itemId").value = "";
    byId("saveItemButton").textContent = "받은함에 저장";
    byId("documentFile").value = "";
    byId("imageFile").value = "";
    byId("textFile").value = "";
    setCaptureKind("note");
    setNotice("");
    selectedId = null;
    void renderItems();
}

function createNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function visibleItems(items) {
    const query = byId("itemSearch").value.trim().toLocaleLowerCase("ko-KR");
    return items.filter(item => {
        if (currentView === "trash" ? !item.deleted : item.deleted) return false;
        if (currentView === "inbox" && item.state !== "inbox") return false;
        if (!query) return true;
        const text = [item.title, item.bodyMarkdown, item.sourceUrl, ...(item.tags || [])].join(" ").toLocaleLowerCase("ko-KR");
        return text.includes(query);
    }).sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

async function renderItems() {
    if (!itemRepository || !currentUser) return;
    const ownerId = currentUser.uid;
    const session = sessionId;
    const result = await itemRepository.list({ includeDeleted: true });
    if (!sessionIsCurrent(session, ownerId)) return;
    byId("inboxCount").textContent = String(result.items.filter(item => !item.deleted && item.state === "inbox").length);
    byId("invalidNotice").classList.toggle("hidden", result.invalid.length === 0);
    byId("invalidNotice").textContent = result.invalid.length
        ? `${result.invalid.length}개 항목을 읽지 못했어요. 원본 JSON 경로와 오류를 보존했습니다.`
        : "";

    const list = byId("itemList");
    list.replaceChildren();
    const items = visibleItems(result.items);
    if (!items.length) {
        list.append(createNode("p", "list-empty", currentView === "inbox" ? "받은함이 비어 있어요. 위에서 새 기록을 추가해보세요." : "표시할 자료가 없어요."));
    }
    for (const item of items) {
        const row = createNode("button", `item-row${selectedId === item.id ? " is-selected" : ""}`);
        row.type = "button";
        row.dataset.itemId = item.id;
        row.append(createNode("span", "item-row-title", item.title));
        const meta = createNode("span", "item-row-meta");
        meta.append(createNode("span", "item-kind", kindLabel(item.kind)), createNode("time", "", formatDate(item.updatedAt)));
        row.append(meta);
        list.append(row);
    }
    await renderDetail(items.find(item => item.id === selectedId) || null, session);
}

async function renderDetail(item, session = sessionId) {
    const panel = byId("itemDetail");
    panel.replaceChildren();
    if (!item) {
        const empty = createNode("div", "detail-empty");
        empty.append(createNode("span", "empty-mark", "✳"));
        empty.append(createNode("strong", "", "자료를 선택하거나 새 기록을 시작해보세요."));
        empty.append(createNode("span", "", "저장한 자료는 오프라인에서도 이 기기에서 볼 수 있어요."));
        panel.append(empty);
        return;
    }

    const topline = createNode("div", "detail-topline");
    topline.append(createNode("span", "detail-kind", kindLabel(item.kind)));
    topline.append(createNode("time", "detail-date", formatDate(item.updatedAt)));
    panel.append(topline, createNode("h3", "detail-title", item.title));
    if (item.sourceUrl) {
        const link = createNode("a", "detail-link", item.sourceUrl);
        link.href = item.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        panel.append(link);
    }
    if (item.kind === "image") {
        await renderImage(item, panel, session);
    } else if (item.bodyMarkdown) {
        panel.append(createNode("div", "detail-body", item.bodyMarkdown));
    }
    if (item.tags?.length) {
        const tags = createNode("div", "detail-tags");
        item.tags.forEach(tag => tags.append(createNode("span", "tag-chip", `#${tag}`)));
        panel.append(tags);
    }
    await renderAttachments(item, panel, session);

    const actions = createNode("div", "detail-actions");
    const edit = createNode("button", "", "편집");
    edit.type = "button";
    edit.addEventListener("click", () => fillCaptureForm(item));
    actions.append(edit);
    if (item.deleted) {
        const restore = createNode("button", "", "받은함으로 복구");
        restore.type = "button";
        restore.addEventListener("click", async () => {
            await itemRepository.restore(item.id);
            currentView = "inbox";
            updateViewButtons();
            selectedId = item.id;
            await renderItems();
        });
        actions.append(restore);
    } else {
        const remove = createNode("button", "danger-button", "삭제");
        remove.type = "button";
        remove.addEventListener("click", async () => {
            await itemRepository.remove(item.id);
            currentView = "trash";
            updateViewButtons();
            selectedId = item.id;
            await renderItems();
        });
        actions.append(remove);
    }
    panel.append(actions);
}

async function renderAttachments(item, panel, session) {
    if (!item.attachmentIds?.length) return;
    const ownerId = currentUser?.uid;
    if (!ownerId) return;
    const records = await attachmentQueue.listPending(ownerId);
    if (!sessionIsCurrent(session, ownerId)) return;
    for (const attachmentId of item.attachmentIds) {
        const localRecord = records.find(record => record.id === attachmentId);
        const metadata = item.attachments?.find(record => record.id === attachmentId);
        const attachment = { ...localRecord, ...metadata };
        if (!localRecord && !metadata) {
            panel.append(createNode("div", "attachment-card", "첨부 파일 정보를 찾을 수 없습니다."));
            continue;
        }
        const card = createNode("div", "attachment-card");
        card.append(createNode("span", "", "▤"));
        const info = createNode("div", "attachment-info");
        info.append(createNode("strong", "", attachment.name));
        const attachmentState = attachment.uploadState === "uploaded"
            ? "Drive에 저장됨"
            : localRecord ? (attachment.uploadState === "failed" ? "업로드 실패 · 이 기기에 보관됨" : "이 기기에서 업로드 대기 중")
                : "원본 파일이 이 기기에 없습니다.";
        info.append(createNode("small", "", attachmentState));
        card.append(info);
        const actions = createNode("div", "attachment-actions");
        if (attachment.providerFileId || localRecord) {
            const openButton = createNode("button", "", attachment.providerFileId ? "열기" : "기기에서 열기");
            openButton.type = "button";
            openButton.addEventListener("click", () => openAttachment(attachment));
            actions.append(openButton);
        }
        if (localRecord && !attachment.providerFileId) {
            const uploadButton = createNode("button", "", driveConnected ? "Drive에 업로드" : "Drive 연결 필요");
            uploadButton.type = "button";
            uploadButton.disabled = !driveConnected;
            uploadButton.addEventListener("click", async () => {
                uploadButton.disabled = true;
                setNotice("문서를 Drive에 안전하게 업로드하고 있어요.");
                try {
                    const receipt = await documentRepository.uploadPending(ownerId, attachment.id);
                    if (!sessionIsCurrent(session, ownerId)) return;
                    const latest = await itemRepository.get(item.id);
                    if (!latest || !receipt?.id) throw new Error("DOCUMENT_UPLOAD_RECEIPT_INVALID");
                    const attachments = (latest.attachments || []).map(entry => entry.id === attachment.id ? {
                        ...entry,
                        providerFileId: receipt.id,
                        sha256: receipt.checksumSha256,
                        uploadState: "uploaded",
                        updatedAt: Date.now()
                    } : entry);
                    await itemRepository.save({ ...latest, attachments });
                    await pkmSync.persist(ownerId, vault.snapshot());
                    await attachmentQueue.clearLocalFile(ownerId, attachment.id);
                    setNotice("업로드와 SHA-256 확인을 마쳤어요.");
                    if (!driveConnected) driveConnected = true;
                    updateDriveStatus();
                    await renderItems();
                } catch (error) {
                    if (!sessionIsCurrent(session, ownerId)) return;
                    setNotice(error.message === "DRIVE_NOT_CONNECTED" ? "먼저 Google Drive를 연결해 주세요." : `업로드하지 못했어요: ${error.message}`, "error");
                    uploadButton.disabled = false;
                }
            });
            actions.append(uploadButton);
        }
        card.append(actions);
        panel.append(card);
    }
}

async function storeImage(file, userId) {
    const imageId = crypto.randomUUID();
    await imageRepository.save(file, { id: imageId, userId });
    if (auth?.currentUser?.uid !== userId) throw new Error("AUTH_SESSION_CHANGED");
    if (!driveConnection?.permissionGranted) return `![${file.name || "image"}](indexeddb://${imageId})`;
    try {
        const result = await driveImageService.upload(file, driveConnection);
        if (auth?.currentUser?.uid !== userId) throw new Error("AUTH_SESSION_CHANGED");
        driveConnection = result.connection;
        return result.driveImage?.fileId
            ? `![${file.name || "image"}](drive://${result.driveImage.fileId})`
            : `![${file.name || "image"}](indexeddb://${imageId})`;
    } catch (error) {
        if (auth?.currentUser?.uid === userId) {
            setNotice(`이미지는 이 기기에 저장했지만 Drive 백업에 실패했어요: ${error.message}`, "error");
        }
        return `![${file.name || "image"}](indexeddb://${imageId})`;
    }
}

async function renderImage(item, panel, session) {
    const match = /^!\[(.*)\]\((drive|indexeddb):\/\/(.*)\)$/.exec(item.bodyMarkdown || "");
    if (!match) {
        if (item.bodyMarkdown) panel.append(createNode("div", "detail-body", item.bodyMarkdown));
        return;
    }
    const ownerId = currentUser?.uid;
    if (!ownerId) return;
    const [, alt, provider, fileId] = match;
    try {
        const local = provider === "indexeddb" ? await imageRepository.get(fileId) : null;
        const blob = provider === "drive" ? await driveImageRepository.download(fileId) : local?.userId === ownerId ? local.blob : null;
        if (!blob) throw new Error("IMAGE_FILE_MISSING");
        if (!sessionIsCurrent(session, ownerId)) return;
        const image = createNode("img", "detail-image");
        image.alt = alt || "첨부 이미지";
        image.loading = "lazy";
        const url = URL.createObjectURL(blob);
        image.src = url;
        image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
        panel.append(image);
        if (provider === "indexeddb") {
            const backup = createNode("button", "image-backup-button", driveConnected ? "Google Drive에 백업" : "Drive 연결 후 백업");
            backup.type = "button";
            backup.disabled = !driveConnected;
            backup.addEventListener("click", async () => {
                backup.disabled = true;
                try {
                    const result = await driveImageService.upload(blob, driveConnection);
                    if (!sessionIsCurrent(session, ownerId)) return;
                    if (!result.driveImage) throw new Error("DRIVE_IMAGE_UPLOAD_FAILED");
                    driveConnection = result.connection;
                    const latest = await itemRepository.get(item.id);
                    await itemRepository.save({ ...latest, bodyMarkdown: `![${alt}](drive://${result.driveImage.fileId})` });
                    await pkmSync.persist(currentUser.uid, vault.snapshot());
                    setNotice("이미지를 Drive에 백업했어요.");
                    await renderItems();
                } catch (error) {
                    if (!sessionIsCurrent(session, ownerId)) return;
                    setNotice(`이미지를 백업하지 못했어요: ${error.message}`, "error");
                    backup.disabled = false;
                }
            });
            panel.append(backup);
        }
    } catch (error) {
        if (sessionIsCurrent(session, ownerId)) panel.append(createNode("p", "image-missing", `이미지를 불러오지 못했어요: ${error.message}`));
    }
}

async function openAttachment(attachment) {
    const ownerId = currentUser?.uid;
    const session = sessionId;
    if (!ownerId) return;
    try {
        const blob = attachment.providerFileId
            ? await documentRepository.download(attachment.providerFileId)
            : await attachmentQueue.loadFile(ownerId, attachment.id);
        if (!sessionIsCurrent(session, ownerId)) return;
        if (!blob) throw new Error("ATTACHMENT_FILE_MISSING");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        if (!attachment.mimeType.includes("pdf")) link.download = attachment.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
        if (sessionIsCurrent(session, ownerId)) setNotice(`첨부 파일을 열지 못했어요: ${error.message}`, "error");
    }
}

function fillCaptureForm(item) {
    selectedId = item.id;
    byId("itemId").value = item.id;
    byId("itemKind").value = item.kind;
    byId("itemTitle").value = item.title;
    byId("sourceUrl").value = item.sourceUrl || "";
    byId("itemBody").value = item.bodyMarkdown || "";
    byId("itemTags").value = (item.tags || []).join(", ");
    byId("documentFile").value = "";
    byId("imageFile").value = "";
    byId("saveItemButton").textContent = "수정 내용 저장";
    setCaptureKind(item.kind);
    setNotice("");
    byId("itemTitle").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void renderItems();
}

function updateViewButtons() {
    document.querySelectorAll("[data-view]").forEach(button => {
        const active = button.dataset.view === currentView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-current", active ? "page" : "false");
    });
    byId("libraryHeading").textContent = ({ inbox: "받은함", all: "전체 자료", trash: "삭제 항목" })[currentView];
}

function sessionIsCurrent(session, userId) {
    return session === sessionId && currentUser?.uid === userId && auth?.currentUser?.uid === userId;
}

function updateDriveStatus() {
    byId("driveStatus").textContent = driveConnected ? "Google Drive 연결됨" : "연결하면 PDF와 DOCX를 동기화할 수 있어요";
    byId("connectDriveButton").setAttribute("aria-label", driveConnected ? "Google Drive 다시 연결" : "Google Drive 연결");
}

async function hydrateUser(user, session) {
    itemRepository = createVaultSecondBrainItemRepository({
        vault,
        userId: user.uid,
        getCurrentUserId: () => auth?.currentUser?.uid
    });
    const local = await localVaultRepository.load(user.uid).catch(() => null);
    let snapshot = local?.snapshot || { schemaVersion: 1, files: [], updatedAt: 0 };
    let dirty = Boolean(local?.dirty);
    try {
        const hydrated = await pkmSync.hydrate(user.uid);
        snapshot = hydrated.snapshot;
        dirty = hydrated.dirty;
    } catch (error) {
        setSyncStatus(local ? "오프라인 · 이 기기 자료" : "동기화 연결 대기", "error");
    }
    if (!sessionIsCurrent(session, user.uid)) return;
    vault.replace(snapshot);
    await renderItems();
    if (dirty) {
        setSyncStatus("동기화 대기 중", "saving");
        void pkmSync.flush(user.uid).catch(() => setSyncStatus("동기화 재시도 대기", "error"));
    } else if (navigator.onLine) {
        setSyncStatus("동기화 완료");
    } else {
        setSyncStatus("오프라인 · 로컬 저장", "saving");
    }
    try {
        const drive = await documentRepository.restoreSession();
        if (sessionIsCurrent(session, user.uid)) {
            driveConnected = drive.active === true;
            driveConnection = driveConnected ? {
                permissionGranted: true,
                promptedAt: Date.now(),
                folderId: drive.folderId || null,
                connectedAt: Date.now()
            } : null;
            updateDriveStatus();
        }
    } catch {
        if (sessionIsCurrent(session, user.uid)) {
            driveConnected = false;
            driveConnection = null;
            updateDriveStatus();
        }
    }
}

async function syncNow() {
    const user = currentUser;
    const session = sessionId;
    if (!user) return;
    byId("syncButton").disabled = true;
    setSyncStatus("동기화 중", "saving");
    try {
        await pkmSync.flush(user.uid);
        const hydrated = await pkmSync.hydrate(user.uid);
        if (!sessionIsCurrent(session, user.uid)) return;
        vault.replace(hydrated.snapshot);
        await renderItems();
        setSyncStatus(hydrated.dirty ? "동기화 대기 중" : "동기화 완료", hydrated.dirty ? "saving" : "idle");
    } catch (error) {
        if (sessionIsCurrent(session, user.uid)) setSyncStatus(`동기화 대기 · ${error.message}`, "error");
    } finally {
        if (sessionIsCurrent(session, user.uid)) byId("syncButton").disabled = false;
    }
}

vault.subscribe((snapshot, change) => {
    if (!currentUser || !["write", "remove", "merge"].includes(change.type)) return;
    const userId = currentUser.uid;
    const session = sessionId;
    setSyncStatus("이 기기에 저장됨 · 동기화 대기", "saving");
    void pkmSync.persist(userId, snapshot).then(() => {
        if (sessionIsCurrent(session, userId)) void renderItems();
    }).catch(error => {
        if (sessionIsCurrent(session, userId)) setSyncStatus(`로컬 저장 실패 · ${error.message}`, "error");
    });
});

byId("itemKind").addEventListener("change", event => setCaptureKind(event.target.value));
byId("textFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        if (file.size > 2_000_000) throw new Error("TEXT_FILE_TOO_LARGE_2_MIB");
        const content = await file.text();
        if (new TextEncoder().encode(content).byteLength > 2_000_000) throw new Error("TEXT_FILE_TOO_LARGE_2_MIB");
        byId("itemKind").value = "note";
        setCaptureKind("note");
        byId("itemBody").value = content;
        if (!byId("itemTitle").value.trim()) byId("itemTitle").value = file.name.replace(/\.(txt|md)$/i, "");
        setNotice("텍스트를 불러왔어요. 저장하면 Vault와 동기화됩니다.");
    } catch (error) {
        setNotice(`파일을 읽지 못했어요: ${error.message}`, "error");
        event.target.value = "";
    }
});
byId("captureForm").addEventListener("submit", async event => {
    event.preventDefault();
    const user = currentUser;
    const session = sessionId;
    if (!user || !itemRepository) return;
    const existingId = byId("itemId").value;
    const id = existingId || crypto.randomUUID();
    const existing = existingId ? await itemRepository.get(existingId) : null;
    const kind = byId("itemKind").value;
    const title = byId("itemTitle").value.trim();
    const sourceUrl = kind === "link" ? byId("sourceUrl").value.trim() : null;
    let bodyMarkdown = byId("itemBody").value;
    const tags = byId("itemTags").value.split(",").map(value => value.trim()).filter(Boolean);
    const file = kind === "document" ? byId("documentFile").files?.[0] : null;
    const imageFile = kind === "image" ? byId("imageFile").files?.[0] : null;
    const attachmentIds = [...(existing?.attachmentIds || [])];
    let queuedAttachmentId = null;
    byId("saveItemButton").disabled = true;
    setNotice("이 기기에 기록을 저장하고 있어요.");
    try {
        if (imageFile) {
            if (imageFile.size > 20 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE_20_MIB");
            bodyMarkdown = await storeImage(imageFile, user.uid);
        }
        let attachments = [...(existing?.attachments || [])];
        if (file) {
            queuedAttachmentId = crypto.randomUUID();
            const createdAt = Date.now();
            const attachment = {
                id: queuedAttachmentId,
                itemId: id,
                name: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                sha256: null,
                provider: "drive",
                providerFileId: null,
                uploadState: "queued",
                extractState: "pending",
                createdAt,
                updatedAt: createdAt
            };
            await attachmentQueue.savePending({
                userId: user.uid,
                attachment,
                file
            });
            attachmentIds.push(queuedAttachmentId);
            attachments.push(attachment);
        }
        if (!sessionIsCurrent(session, user.uid)) throw new Error("AUTH_SESSION_CHANGED");
        await itemRepository.save({
            ...existing,
            id,
            kind,
            title,
            bodyMarkdown,
            sourceUrl,
            tags,
            attachments,
            attachmentIds: [...new Set(attachmentIds)],
            state: existing?.state || "inbox",
            deleted: false
        });
        if (!sessionIsCurrent(session, user.uid)) throw new Error("AUTH_SESSION_CHANGED");
        selectedId = id;
        byId("itemId").value = id;
        byId("saveItemButton").textContent = "수정 내용 저장";
        byId("documentFile").value = "";
        byId("imageFile").value = "";
        const imageIsLocalOnly = imageFile && bodyMarkdown.includes("(indexeddb://");
        setNotice(file
            ? "기록과 문서를 이 기기에 저장했어요. Drive에 업로드하기 전까지는 다른 기기에서 열 수 없습니다."
            : imageIsLocalOnly
                ? "이미지를 이 기기에 저장했어요. Drive에 백업하기 전까지는 다른 기기에서 열 수 없습니다."
                : "기록을 이 기기에 저장했어요.");
        await renderItems();
    } catch (error) {
        if (queuedAttachmentId) await attachmentQueue.removePending(user.uid, queuedAttachmentId).catch(() => {});
        setNotice(`저장하지 못했어요: ${error.message}`, "error");
    } finally {
        byId("saveItemButton").disabled = false;
    }
});

byId("newItemButton").addEventListener("click", resetCapture);
byId("itemSearch").addEventListener("input", () => void renderItems());
byId("itemList").addEventListener("click", event => {
    const row = event.target.closest("[data-item-id]");
    if (!row) return;
    selectedId = row.dataset.itemId;
    void renderItems();
});
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    currentView = button.dataset.view;
    selectedId = null;
    updateViewButtons();
    void renderItems();
}));
byId("syncButton").addEventListener("click", () => void syncNow());
byId("connectDriveButton").addEventListener("click", async () => {
    if (!currentUser) return;
    const ownerId = currentUser.uid;
    const session = sessionId;
    byId("connectDriveButton").disabled = true;
    try {
        const connection = await documentRepository.connect();
        if (!sessionIsCurrent(session, ownerId)) return;
        driveConnected = true;
        driveConnection = {
            permissionGranted: true,
            promptedAt: Date.now(),
            folderId: connection.folderId || null,
            connectedAt: connection.connectedAt || Date.now()
        };
        updateDriveStatus();
        setNotice("Google Drive를 연결했어요. 문서 카드에서 업로드를 이어갈 수 있습니다.");
        await renderItems();
    } catch (error) {
        if (!sessionIsCurrent(session, ownerId)) return;
        setNotice(`Google Drive를 연결하지 못했어요: ${error.message}`, "error");
    } finally {
        if (sessionIsCurrent(session, ownerId)) byId("connectDriveButton").disabled = false;
    }
});

window.addEventListener("focus", () => { if (currentUser) void syncNow(); });
window.addEventListener("online", () => { if (currentUser) void syncNow(); });
window.addEventListener("offline", () => setSyncStatus("오프라인 · 로컬 저장", "saving"));

onAuthStateChanged(auth, user => {
    const session = ++sessionId;
    currentUser = user || null;
    selectedId = null;
    itemRepository = null;
    byId("itemList").replaceChildren();
    byId("itemDetail").replaceChildren();
    byId("authGate").classList.toggle("hidden", Boolean(user));
    byId("userName").textContent = user?.displayName || user?.email || "";
    byId("syncButton").disabled = !user;
    byId("connectDriveButton").disabled = !user;
    if (!user) {
        driveConnected = false;
        driveConnection = null;
        updateDriveStatus();
        setSyncStatus("로그인이 필요해요", "error");
        byId("itemList").replaceChildren();
        byId("itemDetail").replaceChildren();
        return;
    }
    void hydrateUser(user, session).catch(error => {
        if (sessionIsCurrent(session, user.uid)) setSyncStatus(`자료를 불러오지 못했어요 · ${error.message}`, "error");
    });
});
