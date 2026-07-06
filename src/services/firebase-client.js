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
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const fallbackConfig = {
    apiKey: "AIzaSyBJFs1rgUPZqjwZt2wgNuKBXH3uxDpZFXc",
    authDomain: "link-note-c8c1d.firebaseapp.com",
    projectId: "link-note-c8c1d",
    storageBucket: "link-note-c8c1d.firebasestorage.app",
    messagingSenderId: "993879795668",
    appId: "1:993879795668:web:f1401e2c4da1c6cc50d841",
    measurementId: "G-C468ZCLCWH"
};

const viteEnv = import.meta.env || {};

const envConfig = {
    apiKey: viteEnv.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey,
    authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain,
    projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId,
    storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket,
    messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId,
    appId: viteEnv.VITE_FIREBASE_APP_ID || fallbackConfig.appId,
    measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID || fallbackConfig.measurementId
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
    deleteDoc
};
