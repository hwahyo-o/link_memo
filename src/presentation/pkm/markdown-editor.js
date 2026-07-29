import {
    analyzeMarkdownLine,
    continueListLine,
    indentListLine
} from "../../domain/pkm/markdown-display-rules.js";

const LINE_CLASSES = [
    "cm-heading-1", "cm-heading-2", "cm-heading-3",
    "cm-list-item", "cm-list-level-0", "cm-list-level-1", "cm-list-level-2", "cm-list-level-3"
];

function createKeyMap(editor) {
    const changeIndent = direction => {
        const selections = editor.listSelections();
        const lines = new Set();
        selections.forEach(selection => {
            const from = Math.min(selection.anchor.line, selection.head.line);
            const to = Math.max(selection.anchor.line, selection.head.line);
            for (let line = from; line <= to; line += 1) lines.add(line);
        });
        const targets = [...lines].sort((left, right) => right - left);
        if (!targets.some(line => analyzeMarkdownLine(editor.getLine(line)).list)) return false;
        editor.operation(() => targets.forEach(line => {
            const current = editor.getLine(line);
            const next = indentListLine(current, direction);
            if (next !== current) editor.replaceRange(next, { line, ch: 0 }, { line, ch: current.length }, "+input");
        }));
        return true;
    };

    return {
        Enter(instance) {
            if (instance.somethingSelected()) return globalThis.CodeMirror.Pass;
            const cursor = instance.getCursor();
            const line = instance.getLine(cursor.line);
            if (cursor.ch !== line.length) return globalThis.CodeMirror.Pass;
            const continuation = continueListLine(line);
            if (!continuation) return globalThis.CodeMirror.Pass;
            if (continuation.exit) instance.replaceRange("", { line: cursor.line, ch: 0 }, cursor, "+input");
            else instance.replaceRange(`\n${continuation.prefix}`, cursor, cursor, "+input");
        },
        Tab(instance) {
            if (!changeIndent(1)) instance.replaceSelection("    ", "end", "+input");
        },
        "Shift-Tab"() {
            changeIndent(-1);
        }
    };
}

export function createMarkdownEditor({ host }) {
    if (!globalThis.CodeMirror) throw new Error("CODEMIRROR_UNAVAILABLE");
    const listeners = new Set();
    let marks = [];
    let suppressChange = false;
    let composing = false;
    let compositionChanged = false;
    const editor = globalThis.CodeMirror(host, {
        value: "",
        lineWrapping: true,
        inputStyle: "contenteditable",
        spellcheck: true,
        extraKeys: {}
    });
    editor.setOption("extraKeys", createKeyMap(editor));
    editor.setSize("100%", "100%");

    function applyFormatting() {
        editor.operation(() => {
            marks.forEach(mark => mark.clear());
            marks = [];
            editor.eachLine(handle => LINE_CLASSES.forEach(className => editor.removeLineClass(handle, "text", className)));
            for (let lineNumber = 0; lineNumber < editor.lineCount(); lineNumber += 1) {
                const analysis = analyzeMarkdownLine(editor.getLine(lineNumber));
                if (analysis.headingLevel) editor.addLineClass(lineNumber, "text", `cm-heading-${analysis.headingLevel}`);
                if (analysis.list) {
                    editor.addLineClass(lineNumber, "text", "cm-list-item");
                    editor.addLineClass(lineNumber, "text", `cm-list-level-${Math.min(analysis.list.level, 3)}`);
                }
                analysis.marks.forEach(mark => {
                    marks.push(editor.markText(
                        { line: lineNumber, ch: mark.from },
                        { line: lineNumber, ch: mark.to },
                        { className: `cm-mark-${mark.type}` }
                    ));
                });
            }
        });
    }

    function emitChange() {
        listeners.forEach(listener => listener(editor.getValue()));
    }

    editor.on("change", () => {
        applyFormatting();
        if (suppressChange) return;
        if (composing) compositionChanged = true;
        else emitChange();
    });

    const wrapper = editor.getWrapperElement();
    wrapper.addEventListener("compositionstart", () => { composing = true; }, true);
    wrapper.addEventListener("compositionend", () => {
        composing = false;
        if (!compositionChanged) return;
        compositionChanged = false;
        queueMicrotask(emitChange);
    }, true);
    applyFormatting();

    return {
        getValue: () => editor.getValue(),
        setValue(value) {
            suppressChange = true;
            editor.setValue(value || "");
            suppressChange = false;
            editor.clearHistory();
        },
        focus: () => editor.focus(),
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        replaceSelection(value) {
            editor.replaceSelection(value, "end", "+input");
        },
        refresh: () => editor.refresh(),
        destroy() {
            marks.forEach(mark => mark.clear());
            listeners.clear();
            wrapper.remove();
        }
    };
}
