function basename(path) {
    return path.split("/").pop();
}

const TREE_RENDER_LIMIT = 1000;

function groupFiles(files) {
    const groups = new Map();
    for (const file of files) {
        const root = file.path.includes("/") ? file.path.split("/")[0] : "내 지식 베이스";
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(file);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

export function createWorkspace({
    vault,
    fileTree,
    fileCount,
    fileFilter,
    tabs,
    editor,
    editorSurface,
    editorEmpty,
    activeFilePath,
    editorPanel,
    onChange,
    onFinish,
    onUploadImage
}) {
    let activePath = null;
    let openPaths = [];
    let editorTimer = null;

    function renderTree() {
        const filter = fileFilter.value.trim().toLocaleLowerCase();
        const allFiles = vault.list();
        const matchingFiles = allFiles.filter(file => !filter || file.path.toLocaleLowerCase().includes(filter));
        const visibleFiles = matchingFiles.slice(0, TREE_RENDER_LIMIT);
        fileCount.textContent = String(allFiles.length);
        const groups = groupFiles(visibleFiles).map(([group, values]) => {
            const section = document.createElement("section");
            section.className = "file-group";
            const heading = document.createElement("div");
            heading.className = "file-group-label";
            heading.textContent = group;
            section.append(heading, ...values.map(file => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "file-row";
                button.dataset.path = file.path;
                button.setAttribute("aria-current", file.path === activePath ? "page" : "false");
                const icon = document.createElement("span");
                icon.textContent = file.type === "canvas" ? "⌘" : file.type === "json" ? "{}" : "▤";
                const label = document.createElement("span");
                label.textContent = file.path.startsWith(`${group}/`) ? file.path.slice(group.length + 1) : file.path;
                button.append(icon, label);
                button.addEventListener("click", () => open(file.path));
                return button;
            }));
            return section;
        });
        if (matchingFiles.length > TREE_RENDER_LIMIT) {
            const notice = document.createElement("p");
            notice.className = "file-tree-limit";
            notice.textContent = `${matchingFiles.length.toLocaleString()}개 중 ${TREE_RENDER_LIMIT.toLocaleString()}개 표시 · 필터로 범위를 좁혀주세요.`;
            groups.push(notice);
        }
        fileTree.replaceChildren(...groups);
    }

    function renderTabs() {
        tabs.replaceChildren(...openPaths.map(path => {
            const tab = document.createElement("div");
            tab.className = "editor-tab";
            tab.setAttribute("role", "tab");
            tab.setAttribute("tabindex", "0");
            tab.setAttribute("aria-selected", String(path === activePath));
            const label = document.createElement("span");
            label.textContent = basename(path);
            const close = document.createElement("button");
            close.type = "button";
            close.className = "close-tab";
            close.setAttribute("aria-label", `${basename(path)} 닫기`);
            close.textContent = "×";
            close.addEventListener("click", event => {
                event.stopPropagation();
                closePath(path);
            });
            tab.append(label, close);
            tab.addEventListener("click", () => open(path));
            tab.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") open(path);
            });
            return tab;
        }));
    }

    function open(path) {
        const file = vault.read(path);
        if (!file) return;
        activePath = path;
        if (!openPaths.includes(path)) openPaths.push(path);
        editor.value = file.content;
        activeFilePath.textContent = path;
        editorSurface.classList.remove("hidden");
        editorEmpty.classList.add("hidden");
        if (matchMedia("(max-width: 700px)").matches) editorPanel.classList.add("mobile-fullscreen");
        renderTabs();
        renderTree();
        editor.focus();
    }

    function closePath(path) {
        const index = openPaths.indexOf(path);
        if (index < 0) return;
        openPaths.splice(index, 1);
        if (activePath === path) {
            activePath = openPaths[Math.max(0, index - 1)] || null;
            if (activePath) open(activePath);
            else {
                editorSurface.classList.add("hidden");
                editorEmpty.classList.remove("hidden");
                editorPanel.classList.remove("mobile-fullscreen");
            }
        }
        renderTabs();
        renderTree();
        onFinish(path);
    }

    async function saveEditor() {
        if (!activePath) return;
        const savedPath = activePath;
        await vault.write(savedPath, editor.value);
        onChange(savedPath);
    }

    editor.addEventListener("input", () => {
        clearTimeout(editorTimer);
        editorTimer = setTimeout(() => void saveEditor(), 250);
    });
    fileFilter.addEventListener("input", renderTree);

    return {
        render: renderTree,
        open,
        close: closePath,
        async finish() {
            clearTimeout(editorTimer);
            await saveEditor();
            const path = activePath;
            editorPanel.classList.remove("mobile-fullscreen");
            if (path) onFinish(path);
        },
        async flush() {
            clearTimeout(editorTimer);
            await saveEditor();
        },
        async createNote() {
            let index = 1;
            let path = `내 지식 베이스/새 메모 ${index}.md`;
            while (vault.read(path)) path = `내 지식 베이스/새 메모 ${++index}.md`;
            await vault.write(path, `# 새 메모 ${index}\n\n`);
            onChange(path);
            open(path);
        },
        async uploadImage(file) {
            if (!activePath || !file) return;
            const markdown = await onUploadImage(file);
            const start = editor.selectionStart;
            editor.setRangeText(`\n${markdown}\n`, start, editor.selectionEnd, "end");
            await saveEditor();
        },
        activePath: () => activePath
    };
}
