const MAX_EXTRACTED_TEXT_BYTES = 300_000;
const MAX_PDF_PAGES = 1_000;
const utf8 = new TextEncoder();

function limitUtf8Text(value, maxBytes = MAX_EXTRACTED_TEXT_BYTES) {
    let text = "";
    let bytes = 0;
    for (const character of String(value || "")) {
        const size = utf8.encode(character).byteLength;
        if (bytes + size > maxBytes) break;
        text += character;
        bytes += size;
    }
    return text.trim();
}

async function extractPdf(file) {
    const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]);
    GlobalWorkerOptions.workerSrc = worker.default;

    const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
        const document = await loadingTask.promise;
        const pagesToRead = Math.min(document.numPages, MAX_PDF_PAGES);
        const pages = [];
        let bytes = 0;
        let truncated = document.numPages > pagesToRead;

        for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const pageText = content.items
                .filter(item => typeof item.str === "string")
                .map(item => item.str)
                .join(" ");
            const remaining = MAX_EXTRACTED_TEXT_BYTES - bytes;
            const bounded = limitUtf8Text(pageText, remaining);
            pages.push(bounded);
            bytes += utf8.encode(bounded).byteLength;
            page.cleanup();
            if (bytes >= MAX_EXTRACTED_TEXT_BYTES || bounded.length < pageText.trim().length) {
                truncated = true;
                break;
            }
        }

        return {
            text: limitUtf8Text(pages.join("\n\n")),
            state: pages.some(page => page.trim()) ? (truncated ? "partial" : "ready") : "unsupported"
        };
    } finally {
        await loadingTask.destroy();
    }
}

async function extractDocx(file) {
    const module = await import("mammoth");
    const mammoth = module.default || module;
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = limitUtf8Text(result.value);
    if (!text) return { text: "", state: "unsupported" };
    const wasTruncated = utf8.encode(result.value).byteLength > MAX_EXTRACTED_TEXT_BYTES;
    return { text, state: wasTruncated || result.messages.length ? "partial" : "ready" };
}

export async function extractDocumentText(file) {
    if (!file) return { text: "", state: "failed" };

    try {
        const extension = String(file.name || "").toLowerCase().split(".").pop();
        if (extension === "pdf" && file.type === "application/pdf") return await extractPdf(file);
        if (extension === "docx" && file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            return await extractDocx(file);
        }
        return { text: "", state: "unsupported" };
    } catch {
        return { text: "", state: "failed" };
    }
}

export const documentTextExtractionPolicy = Object.freeze({
    maxExtractedTextBytes: MAX_EXTRACTED_TEXT_BYTES,
    maxPdfPages: MAX_PDF_PAGES
});
