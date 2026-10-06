// アンケート回答モーダル
// 配信者（Electron）が開始したアンケートをモーダルで表示し、回答をサーバーに送る
(function () {
    const VOTER_KEY = 'commentable_voter_id';
    const ANSWERED_KEY = 'commentable_answered_surveys';

    let socket = null;
    let modal = null;
    let current = null; // 表示中のアンケート
    const dismissed = new Set(); // このページで閉じたアンケート

    function t(key, fallback) {
        return window.i18next && window.i18next.exists && window.i18next.exists(key) ? window.i18next.t(key) : fallback;
    }

    // ブラウザごとの回答者ID（重複回答の防止と、授業ログでの本人の結びつけに使う）
    function getVoterId() {
        if (window.CommentApp && CommentApp.getParticipantId) {
            return CommentApp.getParticipantId();
        }
        try {
            let id = localStorage.getItem(VOTER_KEY);
            if (!id) {
                id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
                localStorage.setItem(VOTER_KEY, id);
            }
            return id;
        } catch (e) {
            return '';
        }
    }

    function loadAnswered() {
        try {
            return JSON.parse(localStorage.getItem(ANSWERED_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function markAnswered(id) {
        try {
            const answered = loadAnswered().filter(a => a !== id);
            answered.push(id);
            localStorage.setItem(ANSWERED_KEY, JSON.stringify(answered.slice(-50)));
        } catch (e) {
            // localStorage が使えない場合は記録しない
        }
    }

    function getModal() {
        if (!modal) {
            const el = document.getElementById('survey_modal');
            modal = bootstrap.Modal.getOrCreateInstance(el);
            el.addEventListener('hidden.bs.modal', () => {
                if (current) dismissed.add(current.id);
                current = null;
            });
        }
        return modal;
    }

    function updateSubmitState() {
        const checked = document.querySelectorAll('#survey_choices input:checked').length;
        document.getElementById('survey_submit').disabled = checked === 0;
    }

    function show(survey) {
        if (!survey || !survey.id) return;
        if (dismissed.has(survey.id) || loadAnswered().includes(survey.id)) return;
        if (current && current.id === survey.id) return;
        current = survey;
        setAnswered(false);

        document.getElementById('survey_question').textContent = survey.question;
        document.getElementById('survey_hint').textContent = survey.multiple
            ? t('survey_multiple_hint', '複数選択できます')
            : t('survey_single_hint', '1つ選んでください');

        const list = document.getElementById('survey_choices');
        list.innerHTML = '';
        survey.choices.forEach((choice, i) => {
            const id = `survey_choice_${i}`;
            const wrap = document.createElement('div');
            wrap.className = 'form-check fs-5 mb-2';
            const input = document.createElement('input');
            input.className = 'form-check-input';
            input.type = survey.multiple ? 'checkbox' : 'radio';
            input.name = 'survey_choice';
            input.id = id;
            input.value = String(i);
            input.addEventListener('change', updateSubmitState);
            const label = document.createElement('label');
            label.className = 'form-check-label';
            label.htmlFor = id;
            label.textContent = choice;
            wrap.append(input, label);
            list.appendChild(wrap);
        });
        updateSubmitState();
        getModal().show();
    }

    function hide(id) {
        if (current && (!id || current.id === id)) {
            getModal().hide();
        }
    }

    function submit() {
        if (!current || !socket) return;
        const choices = [...document.querySelectorAll('#survey_choices input:checked')].map(el => Number(el.value));
        if (choices.length === 0) return;
        const id = current.id;
        socket.emit('survey answer', { id, voterId: getVoterId(), choices });
        markAnswered(id);

        // お礼を表示してから閉じる
        setAnswered(true);
        setTimeout(() => hide(id), 1500);
    }

    // 回答フォーム／送信完了表示の切り替え
    function setAnswered(answered) {
        document.getElementById('survey_form').classList.toggle('d-none', answered);
        document.getElementById('survey_submit').classList.toggle('d-none', answered);
        document.getElementById('survey_thanks').classList.toggle('d-none', !answered);
    }

    function attach(ioSocket) {
        socket = ioSocket;
        socket.on('survey start', show);
        socket.on('survey end', (data) => hide(data && data.id));
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('survey_submit')?.addEventListener('click', submit);
    });

    window.SurveyApp = { attach };
})();
