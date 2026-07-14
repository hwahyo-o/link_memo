import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    signInWithCustomToken,
    signInAnonymously,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    EmailAuthProvider,
    linkWithCredential,
    linkWithPopup,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    deleteUser
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc, runTransaction, deleteField, FieldPath } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const viteEnv = import.meta.env || {};

const envConfig = {
    apiKey: viteEnv.VITE_FIREBASE_API_KEY,
    authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: viteEnv.VITE_FIREBASE_PROJECT_ID,
    storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: viteEnv.VITE_FIREBASE_APP_ID,
    measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID
};

let config = envConfig;
if (typeof globalThis.__firebase_config !== 'undefined') {
    try {
        const externalConfig = JSON.parse(globalThis.__firebase_config);
        if (Object.keys(externalConfig).length > 0) config = externalConfig;
    } catch {
        console.warn('외부 Firebase 설정을 읽지 못했습니다.');
    }
}

export const hasFirebaseConfig = Boolean(config?.apiKey);
const app = hasFirebaseConfig ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const appId = globalThis.__app_id || 'my-github-memo-app';

export {
    signInWithCustomToken,
    signInAnonymously,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    EmailAuthProvider,
    linkWithCredential,
    linkWithPopup,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    deleteUser,
    doc,
    setDoc,
    onSnapshot,
    deleteDoc,
    runTransaction,
    deleteField,
    FieldPath
};
