// Infrastructure: Firebase 인증 SDK를 애플리케이션에 제공하는 어댑터.
export {
    auth,
    hasFirebaseConfig,
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
} from "../../services/firebase-client.js";
