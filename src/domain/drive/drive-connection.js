// Domain: Drive 권한 상태와 이미지 참조의 유효한 형태를 정의합니다.
export const DRIVE_FOLDER_NAME = "link-memo-img";

export function createDefaultDriveConnection() {
    return {
        permissionGranted: null,
        promptedAt: null,
        folderId: null,
        connectedAt: null
    };
}

export function normalizeDriveConnection(value) {
    const fallback = createDefaultDriveConnection();
    if (!value || typeof value !== "object") return fallback;
    return {
        permissionGranted: value.permissionGranted === true ? true : value.permissionGranted === false ? false : null,
        promptedAt: Number.isFinite(value.promptedAt) ? value.promptedAt : null,
        folderId: typeof value.folderId === "string" && value.folderId ? value.folderId : null,
        connectedAt: Number.isFinite(value.connectedAt) ? value.connectedAt : null
    };
}

export function canUseDrive(connection) {
    return normalizeDriveConnection(connection).permissionGranted === true;
}

export function createDriveImageReference(file) {
    if (!file?.id) return null;
    return {
        fileId: file.id,
        name: file.name || "image",
        mimeType: file.mimeType || "application/octet-stream",
        uploadedAt: Date.now()
    };
}
