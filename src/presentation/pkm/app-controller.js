import { classifyGraphMatches } from "../../domain/pkm/graph-highlight-rules.js";
import { searchMetadata } from "../../domain/pkm/search-engine.js";
import { mergeVaultSnapshots } from "../../domain/pkm/vault-policy.js";
import { isNonPcDevice } from "../../domain/sync/device-policy.js";
import { readBrowserDeviceProfile } from "../../infrastructure/browser/device-profile.js";
import { mainMemoToVaultFiles } from "../../infrastructure/pkm/schema-discovery.js";
import { projectVaultGraph } from "../../application/pkm/graph-projector.js";
import { createGraphView } from "./graph-view.js";
import { createWorkspace } from "./workspace.js";
import { createMobileSaveController } from "../sync/mobile-save-controller.js";

const byId = id => document.getElementById(id);
const deviceIsNonPc = () => isNonPcDevice(readBrowserDeviceProfile());

function enablePaneResizers(workspace) {
    document.querySelectorAll("[data-pane-resizer]").forEach(handle => {
        handle.addEventListener("pointerdown", event => {
            if (matchMedia("(max-width: 1024px)").matches) return;
            handle.setPointerCapture(event.pointerId);
            const move = pointerEvent => {
                const bounds = workspace.getBoundingClientRect();
                if (handle.dataset.paneResizer === "left") {
                    workspace.style.setProperty("--left-pane", `${Math.max(190, Math.min(380, pointerEvent.clientX - bounds.left))}px`);
                } else {
                    workspace.style.setProperty("--right-pane", `${Math.max(280, Math.min(620, bounds.right - pointerEvent.clientX))}px`);
                }
            };
            const finish = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", finish);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", finish);
        });
    });
}

export function createPkmApp({
    auth,
    onAuthStateChanged,
    vault,
    metadataCache,
    graphWorker,
    pkmSync,
    pkmRemoteRepository,
    discoverLocalSchemas,
    discoverMainMemo,
    saveMainNow,
    uploadImage
}) {
    let currentUser = null;
    let workspace = null;
    let unsubscribeRemote = null;
    let currentGraph = { nodes: [], edges: [] };
    let currentMetadata = [];
    let searchMode = "AND";
    let renderSequence = 0;
    let searchTimer = null;
    const pendingUploads = new Set();
    enablePaneResizers(document.querySelector(".workspace"));

    const graphView = createGraphView({
        container: byId("graphCanvas"),
        worker: graphWorker,
        onOpen: path => workspace?.open(path)
    });
    const saveController = createMobileSaveController({
        button: byId("pkmSaveButton"),
        icon: byId("pkmSaveIcon"),
        status: byId("pkmSaveStatus"),
        getUser: () => currentUser,
        saveNow: async () => {
            await Promise.allSettled([...pendingUploads]);
            await Promise.all([pkmSync.flush(currentUser.uid), saveMainNow(currentUser)]);
        },
        alert: message => globalThis.alert(message),
        isNonPc: deviceIsNonPc
    });

    function setSyncStatus(label, state = "idle") {
        const status = byId("syncStatus");
        status.textContent = label;
        status.dataset.state = state;
    }

    function updateSearch() {
        const query = byId("graphSearch").value;
        if (!query.trim()) {
            graphView.clearHighlights();
            byId("fitSearchResults").classList.add("hidden");
            return;
        }
        const directIds = searchMetadata(currentMetadata, query, searchMode).map(entry => entry.path);
        const matches = classifyGraphMatches(currentGraph.nodes, currentGraph.edges, directIds);
        graphView.applyHighlights(matches);
        byId("fitSearchResults").classList.toggle("hidden", matches.direct.size === 0);
    }

    async function renderGraph() {
        const sequence = ++renderSequence;
        const files = vault.list();
        const metadata = await metadataCache.index(files);
        if (sequence !== renderSequence) return;
        currentMetadata = metadata;
        currentGraph = projectVaultGraph(files, metadata);
        graphView.render(currentGraph);
        byId("graphEmpty").classList.toggle("hidden", currentGraph.nodes.length > 0);
        updateSearch();
    }

    function createWorkspaceOnce() {
        if (workspace) return workspace;
        workspace = createWorkspace({
            vault,
            fileTree: byId("fileTree"),
            fileCount: byId("fileCount"),
            fileFilter: byId("fileFilter"),
            tabs: byId("editorTabs"),
            editor: byId("markdownEditor"),
            editorSurface: byId("editorSurface"),
            editorEmpty: byId("editorEmpty"),
            activeFilePath: byId("activeFilePath"),
            editorPanel: byId("editorPanel"),
            onChange: () => {
                byId("localSaveState").lastChild.textContent = "로컬에 저장됨";
                void renderGraph();
            },
            onFinish: path => graphView.center(path),
            onUploadImage: async file => {
                const task = uploadImage(file);
                pendingUploads.add(task);
                try {
                    return await task;
                } finally {
                    pendingUploads.delete(task);
                }
            }
        });
        byId("newNoteButton").addEventListener("click", () => void workspace.createNote());
        byId("finishEditing").addEventListener("click", () => void workspace.finish());
        byId("pkmImageInput").addEventListener("change", event => {
            const [file] = event.target.files || [];
            if (file) void workspace.uploadImage(file).catch(error => {
                console.error("PKM 이미지 업로드 실패", error);
                globalThis.alert("이미지를 저장하지 못했습니다. Drive 연결과 네트워크를 확인해주세요.");
            });
            event.target.value = "";
        });
        return workspace;
    }

    async function hydrate(user) {
        setSyncStatus("데이터 불러오는 중", "saving");
        const [hydrated, localSchemas, mainMemo] = await Promise.all([
            pkmSync.hydrate(user.uid),
            discoverLocalSchemas().catch(() => []),
            discoverMainMemo(user.uid).catch(() => null)
        ]);
        let snapshot = hydrated.snapshot;
        const imported = mainMemoToVaultFiles(mainMemo?.payload);
        if (imported.length) snapshot = mergeVaultSnapshots(snapshot, { files: imported, updatedAt: mainMemo.payload.updatedAt });
        if (!snapshot.files.length) {
            snapshot = mergeVaultSnapshots(snapshot, {
                files: [{
                    path: "내 지식 베이스/시작하기.md",
                    type: "md",
                    content: "# PKM 그래프 시작하기\n\n메모를 작성하고 `[[다른 메모]]` 형식으로 연결해보세요.\n\n#시작",
                    updatedAt: Date.now(),
                    mutationId: "pkm-welcome"
                }]
            });
        }
        vault.replace(snapshot);
        createWorkspaceOnce().render();
        byId("schemaSummary").textContent = `자동 탐색: IndexedDB ${localSchemas.length}개 · Firestore 키 ${mainMemo?.keys?.length || 0}개`;
        if (imported.length && JSON.stringify(snapshot) !== JSON.stringify(hydrated.snapshot)) {
            await pkmSync.persist(user.uid, snapshot);
        }
        await renderGraph();
        setSyncStatus(hydrated.dirty ? "동기화 대기 중" : "동기화 완료");
        if (hydrated.dirty) void pkmSync.flush(user.uid).catch(() => setSyncStatus("동기화 재시도 대기", "error"));
    }

    vault.subscribe((snapshot, change) => {
        if (!currentUser || !["write", "remove", "merge"].includes(change.type)) return;
        setSyncStatus("3분 유휴 동기화 대기", "saving");
        void pkmSync.persist(currentUser.uid, snapshot).then(() => {
            byId("localSaveState").lastChild.textContent = "로컬에 저장됨";
        }).catch(error => {
            console.error("PKM 로컬 저장 실패", error);
            setSyncStatus("로컬 저장 실패", "error");
        });
    });

    byId("graphSearch").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(updateSearch, 300);
    });
    byId("clearSearch").addEventListener("click", () => {
        byId("graphSearch").value = "";
        updateSearch();
        byId("graphSearch").focus();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && byId("graphSearch").value) {
            byId("graphSearch").value = "";
            updateSearch();
        }
    });
    document.querySelectorAll("[data-search-mode]").forEach(button => button.addEventListener("click", () => {
        searchMode = button.dataset.searchMode;
        document.querySelectorAll("[data-search-mode]").forEach(candidate => {
            candidate.setAttribute("aria-pressed", String(candidate === button));
        });
        updateSearch();
    }));
    byId("fitSearchResults").addEventListener("click", () => graphView.fitSearch());
    byId("fitGraph").addEventListener("click", () => graphView.fitAll());
    byId("zoomIn").addEventListener("click", () => graphView.zoomBy(1.2));
    byId("zoomOut").addEventListener("click", () => graphView.zoomBy(0.84));
    byId("togglePan").addEventListener("click", event => {
        const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
        event.currentTarget.setAttribute("aria-pressed", String(enabled));
        graphView.setPanEnabled(enabled);
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && currentUser) void pkmSync.flush(currentUser.uid);
    });
    addEventListener("pagehide", () => {
        if (currentUser) void workspace?.flush?.();
    });

    if (!auth) {
        byId("pkmApp").setAttribute("aria-busy", "false");
        byId("authGate").classList.remove("hidden");
        byId("authGate").querySelector("h2").textContent = "Firebase 설정을 확인해주세요.";
        byId("authGate").querySelector("p").textContent = "배포 환경의 Firebase 설정이 준비되면 Link Memo 로그인 세션을 그대로 이어서 사용합니다.";
        setSyncStatus("Firebase 설정 필요", "error");
        saveController.updateVisibility(null);
        return { destroy: () => { graphView.destroy(); graphWorker.terminate(); } };
    }

    onAuthStateChanged(auth, user => {
        unsubscribeRemote?.();
        currentUser = user;
        byId("pkmApp").setAttribute("aria-busy", "false");
        byId("authGate").classList.toggle("hidden", Boolean(user));
        byId("pkmUser").textContent = user?.email || (user?.isAnonymous ? "게스트" : "");
        saveController.updateVisibility(user);
        if (!user) {
            setSyncStatus("로그인 필요", "error");
            return;
        }
        saveController.maybeShowOnboarding(user);
        void hydrate(user).then(() => {
            unsubscribeRemote = pkmRemoteRepository.subscribe(user.uid, remote => {
                if (!remote?.snapshot) return;
                vault.replace(mergeVaultSnapshots(vault.snapshot(), remote.snapshot));
                workspace?.render();
                void renderGraph();
                setSyncStatus("원격 변경 반영됨");
            }, error => {
                console.error("PKM 실시간 동기화 실패", error);
                setSyncStatus("동기화 재시도 대기", "error");
            });
        }).catch(error => {
            console.error("PKM 초기화 실패", error);
            setSyncStatus("데이터를 불러오지 못함", "error");
        });
    });

    return { destroy: () => { unsubscribeRemote?.(); graphView.destroy(); graphWorker.terminate(); } };
}
