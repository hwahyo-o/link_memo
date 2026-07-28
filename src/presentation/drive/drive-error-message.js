const DRIVE_ERROR_MESSAGES = {
    DRIVE_OAUTH_CLIENT_ID_MISSING: "Google Drive OAuth 설정이 배포에 포함되지 않았습니다. 관리자에게 문의해주세요.",
    DRIVE_WORKER_URL_MISSING: "Google Drive 연결 주소가 배포에 포함되지 않았습니다. 관리자에게 문의해주세요.",
    DRIVE_WORKER_AUTH_REQUIRED: "로그인 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도해주세요.",
    DRIVE_WORKER_UNREACHABLE: "Google Drive 연결 서버에 접근하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해주세요.",
    ORIGIN_NOT_ALLOWED: "현재 사이트 주소가 Google Drive 연결 서버에 허용되지 않았습니다.",
    UNAUTHENTICATED: "Google Drive 연결 인증이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.",
    GOOGLE_LOGIN_REQUIRED: "Google 계정으로 다시 로그인한 뒤 Drive 연결을 시도해주세요.",
    DRIVE_ACCOUNT_MISMATCH: "Drive 권한은 현재 링크 메모에 로그인한 Google 계정으로만 연결할 수 있습니다.",
    DRIVE_OFFLINE_ACCESS_REQUIRED: "Google에서 장기 Drive 연결 정보를 받지 못했습니다. Drive 연결을 해제한 뒤 다시 승인해주세요.",
    DRIVE_REAUTH_REQUIRED: "기존 Google Drive 권한을 초기화했습니다. Drive 연결 버튼을 다시 눌러 승인해주세요.",
    GOOGLE_TOKEN_EXCHANGE_FAILED: "Google 권한 코드를 교환하지 못했습니다. 관리자에게 OAuth 설정 확인을 요청해주세요.",
    TOKEN_ENCRYPTION_KEY_INVALID: "Drive 보안 저장소 설정이 올바르지 않습니다. 관리자에게 문의해주세요.",
    DRIVE_CREDENTIALS_CORRUPTED: "저장된 Drive 연결 정보가 손상되었습니다. Drive 연결을 해제한 뒤 다시 연결해주세요.",
    DRIVE_CREDENTIALS_RECOVERY_REQUIRED: "기존 Drive 연결 정보를 읽을 수 없습니다. Drive 연결을 해제한 뒤 다시 연결해주세요.",
    DRIVE_NOT_CONNECTED: "Drive 연결 정보가 없습니다. Drive 연결을 다시 완료해주세요.",
    DRIVE_TOKEN_REFRESH_FAILED: "Drive 연결이 만료되었습니다. Drive 연결을 해제한 뒤 다시 승인해주세요.",
    DRIVE_API_403: "Google Drive 권한이 없거나 만료되었습니다. Drive를 다시 연결해주세요.",
    DRIVE_API_429: "Google Drive 요청이 잠시 제한되었습니다. 잠시 후 다시 시도해주세요."
};

export function getDriveErrorMessage(error) {
    if (DRIVE_ERROR_MESSAGES[error?.message]) return DRIVE_ERROR_MESSAGES[error.message];
    if (["popup_closed_by_user", "popup_closed"].includes(error?.code) || ["popup_closed_by_user", "popup_closed"].includes(error?.message)) {
        return "Google Drive 권한 승인이 취소되었습니다.";
    }
    if (error?.message === "popup_failed_to_open") {
        return "Google 권한 창을 열지 못했습니다. 브라우저의 팝업 차단을 해제해주세요.";
    }
    if (error?.message === "unknown") {
        return "Google 권한 창에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    }
    return "Google Drive 연결 처리에 실패했습니다. 잠시 후 다시 시도해주세요.";
}
