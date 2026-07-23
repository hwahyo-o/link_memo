const ONBOARDING_KEY = "link-memo:mobile-save-onboarding-v1";
const ONBOARDING_MESSAGE = "모바일에서 편집을 완료한 후에는 상단의 세이브 버튼을 눌러 저장까지 완료해주세요.";

const BUTTON_STATES = {
    idle: ["fa-solid fa-floppy-disk", "모든 데이터 즉시 저장"],
    saving: ["fa-solid fa-spinner fa-spin", "모든 데이터를 저장하는 중"],
    success: ["fa-solid fa-check", "모든 데이터 저장 완료"],
    error: ["fa-solid fa-triangle-exclamation", "모든 데이터 저장 실패"]
};

export function createMobileSaveController({
    button,
    icon,
    status,
    getUser,
    saveNow,
    alert,
    storage = localStorage,
    isMobile = () => matchMedia("(max-width: 767px)").matches,
    setTimer = setTimeout,
    onError = console.error
}) {
    let request = null;
    let onboardingShown = false;

    function render(state) {
        const [iconClass, label] = BUTTON_STATES[state];
        icon.className = iconClass;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.disabled = state !== "idle";
        status.textContent = label;
    }

    function updateVisibility(user = getUser()) {
        button.classList.toggle("hidden", !user || user.isAnonymous);
    }

    function maybeShowOnboarding(user = getUser()) {
        if (onboardingShown || !user || user.isAnonymous || !isMobile()) return false;
        try {
            if (storage.getItem(ONBOARDING_KEY)) return false;
            storage.setItem(ONBOARDING_KEY, "1");
        } catch {}
        onboardingShown = true;
        setTimer(() => alert(ONBOARDING_MESSAGE), 350);
        return true;
    }

    function save() {
        const user = getUser();
        if (!user || user.isAnonymous) return Promise.resolve(false);
        if (request) return request;
        render("saving");
        request = Promise.resolve()
            .then(saveNow)
            .then(
                () => { render("success"); return true; },
                error => {
                    onError("모바일 즉시 저장 실패", error);
                    render("error");
                    alert("모든 데이터를 저장하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.");
                    return false;
                }
            )
            .finally(() => {
                setTimer(() => {
                    request = null;
                    render("idle");
                }, 1200);
            });
        return request;
    }

    render("idle");
    return { updateVisibility, maybeShowOnboarding, save };
}
