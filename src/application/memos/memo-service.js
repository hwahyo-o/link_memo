import { normalizeMemoInput } from "../../domain/memos/memo-policy.js";

// Application: 메모 입력 규칙과 이미지 저장소를 조합해 하나의 작업으로 실행합니다.
export function createMemoService({ imageRepository }) {
    return {
        validateInput(input) {
            return normalizeMemoInput(input);
        },

        saveImage(file, options) {
            return imageRepository.save(file, options);
        },

        getImage(imageId) {
            return imageRepository.get(imageId);
        },

        deleteImage(imageId) {
            return imageRepository.delete(imageId);
        },

        clearImages(userId) {
            return imageRepository.clearByUser(userId);
        }
    };
}
