export function createPkmImageUploader({
    getCurrentUser,
    localImageRepository,
    driveImageService,
    getDriveConnection,
    setDriveConnection
}) {
    return async function uploadImage(file) {
        const user = getCurrentUser();
        if (!user) throw new Error("UNAUTHENTICATED");
        const userId = user.uid;
        const imageId = crypto.randomUUID?.() || `pkm_image_${Date.now()}`;
        await localImageRepository.save(file, { id: imageId, userId });
        if (getCurrentUser()?.uid !== userId) throw new Error("AUTH_SESSION_CHANGED");

        const upload = driveImageService.upload(file, getDriveConnection());
        const result = await upload;
        if (getCurrentUser()?.uid !== userId) throw new Error("AUTH_SESSION_CHANGED");

        setDriveConnection(result.connection);
        const source = result.driveImage?.fileId ? `drive://${result.driveImage.fileId}` : `indexeddb://${imageId}`;
        return `![${file.name || "image"}](${source})`;
    };
}
