import {
    canUseDrive,
    createDriveImageReference,
    normalizeDriveConnection
} from "../../domain/drive/drive-connection.js";

// Application: 최초 권한 연결은 명시적 사용자 동작으로만 수행하고, 이후 이미지 요청은 서버 세션으로 처리합니다.
export function createDriveImageService({ localImageRepository, driveImageRepository, driveCodeProvider }) {
    async function connect(connection, { loginHint = "" } = {}) {
        const authorizationCode = await driveCodeProvider.requestCode({ loginHint });
        const remote = await driveImageRepository.connect(authorizationCode);
        return {
            permissionGranted: true,
            promptedAt: Date.now(),
            folderId: remote.folderId,
            connectedAt: remote.connectedAt || Date.now()
        };
    }

    async function restoreSession(connection) {
        if (!canUseDrive(connection)) return false;
        try {
            const session = await driveImageRepository.restoreSession();
            return session.active === true;
        } catch {
            return false;
        }
    }

    async function upload(file, connection) {
        if (!canUseDrive(connection)) return { driveImage: null, connection: normalizeDriveConnection(connection) };
        const fileMetadata = await driveImageRepository.upload(file);
        return {
            driveImage: createDriveImageReference(fileMetadata),
            connection: { ...normalizeDriveConnection(connection), connectedAt: Date.now() }
        };
    }

    async function loadImage(item, connection) {
        if (item?.driveImage?.fileId && canUseDrive(connection)) {
            try {
                const blob = await driveImageRepository.download(item.driveImage.fileId);
                return { blob, source: "drive" };
            } catch (error) {
                console.warn("Drive 이미지를 불러오지 못했습니다. 로컬 이미지를 확인합니다.", error);
            }
        }
        const local = item?.imageId ? await localImageRepository.get(item.imageId) : null;
        return local?.blob ? { blob: local.blob, source: "local" } : null;
    }

    function prefetchImage(item, connection) {
        if (!item?.driveImage?.fileId || !canUseDrive(connection)) return;
        void driveImageRepository.prefetch(item.driveImage.fileId);
    }

    async function migrateExistingImages(linkData, connection) {
        let nextConnection = normalizeDriveConnection(connection);
        let uploaded = 0;
        let failed = 0;
        for (const subcategories of Object.values(linkData || {})) {
            for (const subcategory of subcategories || []) {
                for (const link of subcategory.links || []) {
                    if (!link.imageId || link.driveImage?.fileId) continue;
                    const local = await localImageRepository.get(link.imageId);
                    if (!local?.blob) continue;
                    try {
                        const result = await upload(local.blob, nextConnection);
                        link.driveImage = result.driveImage;
                        nextConnection = result.connection;
                        uploaded += 1;
                    } catch (error) {
                        console.warn("기존 이미지 Drive 업로드 실패", error);
                        failed += 1;
                    }
                }
            }
        }
        return { connection: nextConnection, uploaded, failed };
    }

    async function removeDriveImage(reference) {
        if (!reference?.fileId) return;
        try { await driveImageRepository.remove(reference.fileId); }
        catch (error) { console.warn("Drive 이미지 삭제 실패", error); }
    }

    return { connect, restoreSession, upload, loadImage, prefetchImage, migrateExistingImages, removeDriveImage };
}
