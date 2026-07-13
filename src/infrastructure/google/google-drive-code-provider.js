const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "openid email https://www.googleapis.com/auth/drive.file";

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

// 최초 사용자 제스처에서만 authorization code를 요청합니다. access/refresh token은 브라우저로 반환되지 않습니다.
export function createGoogleDriveCodeProvider({ clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID } = {}) {
    return {
        async requestCode({ loginHint = "" } = {}) {
            if (!clientId) throw new Error("DRIVE_OAUTH_CLIENT_ID_MISSING");
            await loadGoogleIdentityServices();
            return new Promise((resolve, reject) => {
                const client = globalThis.google.accounts.oauth2.initCodeClient({
                    client_id: clientId,
                    scope: DRIVE_SCOPE,
                    ux_mode: "popup",
                    ...(loginHint ? { login_hint: loginHint } : {}),
                    callback: response => {
                        if (!response.code) {
                            reject(Object.assign(new Error(response.error || "DRIVE_AUTH_FAILED"), { code: response.error }));
                            return;
                        }
                        resolve(response.code);
                    }
                });
                client.requestCode();
            });
        }
    };
}
