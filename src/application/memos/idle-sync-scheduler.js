// Application: 마지막 변경 뒤 유휴 시간이 지난 작업만 한 번 실행합니다.
export function createIdleSyncScheduler({ delay, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let timer = null;

    const cancel = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };

    return {
        schedule(task) {
            cancel();
            timer = setTimer(() => {
                timer = null;
                void Promise.resolve(task()).catch(() => {});
            }, delay);
        },
        cancel
    };
}
