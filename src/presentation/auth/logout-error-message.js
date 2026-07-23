const WORKER_CONFIGURATION_ERRORS = new Set([
    "BACKUP_WORKER_URL_MISSING",
    "NOT_FOUND",
    "BACKUP_WORKER_INCOMPATIBLE"
]);

export function getLogoutErrorMessage(error) {
    if (error?.syncStage === "cloudflare-checkpoint") {
        if (WORKER_CONFIGURATION_ERRORS.has(error.message)) {
            return "Cloudflare 백업 연결 주소 또는 API가 현재 배포와 일치하지 않아 로그아웃을 중단했습니다. 잠시 후 새로고침하고 다시 시도해주세요.";
        }
        return "Firestore 저장은 완료됐지만 Cloudflare 종료 체크포인트 저장에 실패해 로그아웃을 중단했습니다. 잠시 후 다시 시도해주세요.";
    }
    if (error?.message === "MEMO_SYNC_INCOMPLETE") {
        return "이 기기의 최신 변경 내용을 안전하게 확인하지 못해 로그아웃을 중단했습니다. 동기화가 끝난 뒤 다시 시도해주세요.";
    }
    return "최신 데이터를 클라우드에 완전히 저장하지 못해 로그아웃을 중단했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.";
}
