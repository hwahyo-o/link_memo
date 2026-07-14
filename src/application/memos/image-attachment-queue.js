// Application: 링크 생성 이후 이미지 저장과 Drive 업로드를 UI와 분리해 백그라운드로 처리합니다.
export function createImageAttachmentQueue({ saveLocalImage, uploadDriveImage, createAttachmentId, canUploadToDrive, concurrency = 2 }) {
    async function process({ files, onAttachment, onProgress }) {
        const items = Array.from(files || []);
        const result = { total: items.length, completed: 0, failed: 0, driveFailed: 0 };
        let cursor = 0;

        const report = () => onProgress?.({ ...result, pending: result.total - result.completed - result.failed });

        async function worker() {
            while (cursor < items.length) {
                const file = items[cursor++];
                try {
                    const imageId = await saveLocalImage(file);
                    const attachment = { id: createAttachmentId(), imageId, driveImage: null };
                    onAttachment?.(attachment);
                    if (canUploadToDrive()) {
                        try {
                            attachment.driveImage = await uploadDriveImage(file);
                        } catch (error) {
                            result.driveFailed += 1;
                            console.warn("Drive 이미지 업로드 실패: 로컬 이미지로 유지합니다.", error);
                        }
                    }
                    result.completed += 1;
                } catch (error) {
                    result.failed += 1;
                    console.warn("이미지 로컬 저장 실패", error);
                }
                report();
            }
        }

        report();
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
        return result;
    }

    return { process };
}
