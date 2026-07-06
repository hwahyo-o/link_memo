export function createModalController() {
    const modal = document.getElementById('customModal');
    const title = document.getElementById('modalTitle');
    const message = document.getElementById('modalMessage');
    const input = document.getElementById('modalInput');
    const cancelButton = document.getElementById('modalCancelBtn');
    const confirmButton = document.getElementById('modalConfirmBtn');
    let currentCallback = null;

    const close = () => {
        modal.classList.add('hidden');
        currentCallback = null;
    };

    const confirm = () => {
        const value = input.value;
        const callback = currentCallback;
        close();
        if (callback) callback(value);
    };

    const open = ({ type, modalTitle, modalMessage, defaultValue = '', onConfirm = null }) => {
        title.textContent = modalTitle;
        message.textContent = modalMessage;
        currentCallback = onConfirm;
        input.value = defaultValue;
        input.classList.add('hidden');
        cancelButton.classList.add('hidden');
        input.onkeydown = null;

        if (type === 'prompt') {
            input.classList.remove('hidden');
            cancelButton.classList.remove('hidden');
            input.style.height = 'auto';
            setTimeout(() => {
                input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
                input.focus();
            }, 50);
            input.onkeydown = event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    confirm();
                }
            };
        } else if (type === 'confirm') {
            cancelButton.classList.remove('hidden');
        }
        modal.classList.remove('hidden');
    };

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    });
    confirmButton.onclick = confirm;
    cancelButton.onclick = close;

    return {
        customAlert: modalMessage => open({ type: 'alert', modalTitle: '알림', modalMessage }),
        customConfirm: (modalMessage, onConfirm) => open({ type: 'confirm', modalTitle: '확인', modalMessage, onConfirm }),
        customPrompt: (modalMessage, defaultValue, onConfirm) => open({ type: 'prompt', modalTitle: '입력', modalMessage, defaultValue, onConfirm })
    };
}
