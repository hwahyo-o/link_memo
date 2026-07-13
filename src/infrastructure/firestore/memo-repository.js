import { db, appId, doc, setDoc, onSnapshot, deleteDoc } from "../firebase/firebase-client.js";

// Infrastructure: Firestore 문서 구조와 SDK 호출을 이 모듈 안에 가둡니다.
export function createFirestoreMemoRepository({ database = db, applicationId = appId } = {}) {
    const getReference = userId => {
        if (!database || !userId) return null;
        return doc(database, "artifacts", applicationId, "users", userId, "memoData", "main");
    };

    return {
        subscribe(userId, onData, onError) {
            const reference = getReference(userId);
            if (!reference) return () => {};
            return onSnapshot(reference, onData, onError);
        },

        save(userId, data) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            return setDoc(reference, data);
        },

        savePreferences(userId, uiPreferences) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            return setDoc(reference, { uiPreferences }, { merge: true });
        },

        delete(userId) {
            const reference = getReference(userId);
            if (!reference) return Promise.resolve();
            return deleteDoc(reference);
        }
    };
}
