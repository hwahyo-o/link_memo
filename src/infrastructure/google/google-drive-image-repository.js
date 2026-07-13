import { DRIVE_FOLDER_NAME } from "../../domain/drive/drive-connection.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

function escapeDriveQuery(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function createGoogleDriveImageRepository({ tokenProvider }) {
    async function request(url, options = {}, { interactive = false } = {}) {
        const token = await tokenProvider.getAccessToken({ interactive });
        const response = await fetch(url, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
        });
        if (!response.ok) {
            const error = new Error(`DRIVE_REQUEST_FAILED_${response.status}`);
            error.status = response.status;
            throw error;
        }
        return response;
    }

    async function ensureFolder(existingFolderId, { interactive = false } = {}) {
        if (existingFolderId) return existingFolderId;
        const query = `name = '${escapeDriveQuery(DRIVE_FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const listResponse = await request(`${DRIVE_API}?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`, {}, { interactive });
        const list = await listResponse.json();
        if (list.files?.[0]?.id) return list.files[0].id;

        const createResponse = await request(DRIVE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
        }, { interactive });
        return (await createResponse.json()).id;
    }

    async function upload(file, folderId, { interactive = false } = {}) {
        const boundary = `link_memo_${crypto.randomUUID()}`;
        const metadata = {
            name: file.name || `link-memo-${Date.now()}`,
            parents: [folderId],
            mimeType: file.type || "application/octet-stream",
            appProperties: { linkMemo: "true" }
        };
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
            JSON.stringify(metadata),
            `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
            file,
            `\r\n--${boundary}--`
        ], { type: `multipart/related; boundary=${boundary}` });
        const response = await request(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType`, {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body
        }, { interactive });
        return response.json();
    }

    async function download(fileId, { interactive = false } = {}) {
        const response = await request(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`, {}, { interactive });
        return response.blob();
    }

    async function remove(fileId, { interactive = false } = {}) {
        if (!fileId) return;
        await request(`${DRIVE_API}/${encodeURIComponent(fileId)}`, { method: "DELETE" }, { interactive });
    }

    return { ensureFolder, upload, download, remove };
}
