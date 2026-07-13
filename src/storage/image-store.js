// Compatibility export: IndexedDB 구현은 infrastructure 계층으로 이동했습니다.
import { imageRepository } from "../infrastructure/browser/indexeddb-image-repository.js";

export const saveImageFile = (...args) => imageRepository.save(...args);
export const getImage = (...args) => imageRepository.get(...args);
export const deleteImage = (...args) => imageRepository.delete(...args);
export const clearUserImages = (...args) => imageRepository.clearByUser(...args);
