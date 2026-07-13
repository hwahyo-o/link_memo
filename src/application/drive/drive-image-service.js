import {
    canUseDrive,
    createDriveImageReference,
    normalizeDriveConnection
} from "../../domain/drive/drive-connection.js";

// Application: Drive와 로컬 이미지 저장소를 조합해 업로드·마이그레이션·미리보기를 처리합니다.
export function createDriveImageService({ localImageRepository, driveImageRepository }) {
    async function connect(connection) {
        const folderId = await driveImageRepository.ensureFolder(normalizeDriveConnection(connection).folderId, { interactive: true });
        return {
            permissionGranted: true,
            promptedAt: Date.now(),
            folderId,
            connectedAt: Date.now()
        };
    }

    async function restoreSession(connection) {
        if (!canUseDrive(connection)) return false;
        try {
            await driveImageRepository.ensureFolder(connection.folderId);
            return true;
        } catch (error) {
            return false;
        }
    }

    async function upload(file, connection) {
        if (!canUseDrive(connection)) return { driveImage: null, connection: normalizeDriveConnection(connection) };
        const folderId = await driveImageRepository.ensureFolder(connection.folderId);
        const fileMetadata = await driveImageRepository.upload(file, folderId);
        return {
            driveImage: createDriveImageReference(fileMetadata),
            connection: { ...normalizeDriveConnection(connection), folderId, connectedAt: Date.now() }
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
        try {
            await driveImageRepository.remove(reference.fileId);
        } catch (error) {
            console.warn("Drive 이미지 삭제 실패", error);
        }
    }

    return { connect, restoreSession, upload, loadImage, migrateExistingImages, removeDriveImage };
}
