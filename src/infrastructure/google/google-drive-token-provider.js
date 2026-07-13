const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";

function loadGoogleIdentityServices() {
    if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-link-memo-google-identity="true"]');
        if (existing) {
            existing.addEventListener("load", resolve, { once: true });
            existing.addEventListener("error", () => reject(new Error("GOOGLE_IDENTITY_LOAD_FAILED")), { once: true });
            return;
        }
        const script = document.createElement("script");
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.defer = true;
        script.dataset.linkMemoGoogleIdentity = "true";
        script.onload = resolve;
        script.onerror = () => reject(new Error("GOOGLE_IDENTITY_LOAD_FAILED"));
        document.head.appendChild(script);
    });
}

// Infrastructure: OAuth access token은 메모리에만 보관하고 Firestore에는 저장하지 않습니다.
export function createGoogleDriveTokenProvider({ clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID } = {}) {
    let accessToken = null;
    let expiresAt = 0;

    const hasUsableToken = () => Boolean(accessToken) && Date.now() < expiresAt - 30_000;

    async function requestToken({ interactive }) {
        if (!clientId) throw new Error("DRIVE_OAUTH_CLIENT_ID_MISSING");
        await loadGoogleIdentityServices();

        return new Promise((resolve, reject) => {
            const tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: DRIVE_SCOPE,
                callback: response => {
                    if (response.error || !response.access_token) {
                        reject(Object.assign(new Error(response.error || "DRIVE_AUTH_FAILED"), { code: response.error }));
                        return;
                    }
                    accessToken = response.access_token;
                    expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
                    resolve(accessToken);
                }
            });
            tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
        });
    }

    return {
        async getAccessToken({ interactive = false } = {}) {
            if (hasUsableToken()) return accessToken;
            return requestToken({ interactive });
        },
        clear() {
            accessToken = null;
            expiresAt = 0;
        }
    };
}
