import {
    canUseDrive,
    createDriveImageReference,
    normalizeDriveConnection
} from "../../domain/drive/drive-connection.js";

const VERIFY_BATCH_SIZE = 20;

function getImages(linkData) {
    const images = [];
    for (const subcategories of Object.values(linkData || {})) {
        for (const subcategory of subcategories || []) {
            for (const link of subcategory.links || []) {
                if (Array.isArray(link.images)) images.push(...link.images.filter(image => image?.imageId));
                else if (link?.imageId) images.push(link);
            }
        }
    }
    return images;
}

function isMissingDriveError(error) {
    return ["DRIVE_API_403", "DRIVE_API_404", "DRIVE_FILE_UNAVAILABLE"].includes(error?.message);
}

// Application layer: 권한 연결, 비공개 이미지 동기화, 유실 파일 복구를 조율합니다.
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
            const session = await driveImageRepository.restoreSession({ warm: true });
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
        let driveMissing = false;
        if (item?.driveImage?.fileId && canUseDrive(connection) && item.driveImage.availability !== "missing") {
            try {
                const blob = await driveImageRepository.download(item.driveImage.fileId);
                return { blob, source: "drive", driveMissing: false };
            } catch (error) {
                driveMissing = isMissingDriveError(error);
                console.warn("Drive 이미지를 불러오지 못했습니다. 로컬 이미지를 확인합니다.", error);
            }
        }
        const local = item?.imageId ? await localImageRepository.get(item.imageId) : null;
        return local?.blob ? { blob: local.blob, source: "local", driveMissing } : { blob: null, source: null, driveMissing };
    }

    function prefetchImage(item, connection) {
        if (!item?.driveImage?.fileId || !canUseDrive(connection) || item.driveImage.availability === "missing") return;
        void driveImageRepository.prefetch(item.driveImage.fileId);
    }

    async function repairImage(item, connection) {
        if (!item?.imageId || !canUseDrive(connection)) {
            return { repaired: false, reason: "DRIVE_NOT_AVAILABLE", connection: normalizeDriveConnection(connection) };
        }
        const local = await localImageRepository.get(item.imageId);
        if (!local?.blob) {
            item.driveImage = item.driveImage ? { ...item.driveImage, availability: "missing", checkedAt: Date.now() } : item.driveImage;
            return { repaired: false, reason: "LOCAL_IMAGE_MISSING", connection: normalizeDriveConnection(connection) };
        }
        const result = await upload(local.blob, connection);
        item.driveImage = result.driveImage;
        return { repaired: true, reason: null, connection: result.connection };
    }

    async function repairDriveImages(linkData, connection, { onProgress } = {}) {
        let nextConnection = normalizeDriveConnection(connection);
        const links = getImages(linkData).filter(image => image?.imageId);
        const remoteLinks = links.filter(link => link.driveImage?.fileId);
        const stateByFileId = new Map();

        for (let start = 0; start < remoteLinks.length; start += VERIFY_BATCH_SIZE) {
            const batch = remoteLinks.slice(start, start + VERIFY_BATCH_SIZE);
            try {
                const verification = await driveImageRepository.verifyImages(batch.map(link => link.driveImage.fileId));
                for (const image of verification.images || []) stateByFileId.set(image.fileId, image.state);
            } catch (error) {
                return {
                    connection: nextConnection,
                    total: links.length,
                    available: 0,
                    uploaded: 0,
                    repaired: 0,
                    unrecoverable: 0,
                    failed: links.length,
                    error
                };
            }
        }

        const result = { connection: nextConnection, total: links.length, available: 0, uploaded: 0, repaired: 0, unrecoverable: 0, failed: 0 };
        let completed = 0;
        for (const link of links) {
            const isAvailable = link.driveImage?.fileId && stateByFileId.get(link.driveImage.fileId) === "available";
            if (isAvailable) {
                if (link.driveImage.availability) delete link.driveImage.availability;
                result.available += 1;
            } else {
                const hadDriveReference = Boolean(link.driveImage?.fileId);
                try {
                    const repaired = await repairImage(link, nextConnection);
                    nextConnection = repaired.connection;
                    if (repaired.repaired) {
                        if (hadDriveReference) result.repaired += 1;
                        else result.uploaded += 1;
                    } else if (repaired.reason === "LOCAL_IMAGE_MISSING") {
                        result.unrecoverable += 1;
                    } else {
                        result.failed += 1;
                    }
                } catch (error) {
                    console.warn("Drive 이미지 복구 실패", error);
                    result.failed += 1;
                }
            }
            completed += 1;
            onProgress?.({ completed, total: links.length, ...result });
        }
        result.connection = nextConnection;
        return result;
    }

    async function removeDriveImage(reference) {
        if (!reference?.fileId) return;
        try { await driveImageRepository.remove(reference.fileId); }
        catch (error) { console.warn("Drive 이미지 삭제 실패", error); }
    }

    return { connect, restoreSession, upload, loadImage, prefetchImage, repairImage, repairDriveImages, removeDriveImage };
}
