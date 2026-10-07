// 授業参画度ページの画面処理（計算は score.js）
(function () {
    const S = window.EngagementScore;
    const SETTINGS_KEY = 'engagementSettings';
    const $ = id => document.getElementById(id);

    const WARNING_BADGES = {
        multiDevice: { label: '複数端末', cls: 'text-bg-secondary' },
        sharedBrowser: { label: '別名あり', cls: 'text-bg-danger' },
        estimated: { label: '補完', cls: 'text-bg-warning' }
    };

    let files = [];        // { name, events, invalid }
    let sessions = [];     // groupSessions の結果（include / start / end を画面で変更する）
    let sessionEdits = {}; // 授業回のキー → { include, start, end }（ファイルを足しても選択を保つ）
    let settings = loadSettings();
    let result = null;
    let sort = { key: 'name', dir: 1 };
    let expanded = new Set();

    // ---------- 設定 ----------

    function loadSettings() {
        try {
            return S.mergeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
        } catch (e) {
            return S.mergeSettings(null);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            // 保存できない環境でも計算はできる
        }
    }

    const NUMBER_SETTINGS = ['presenceFull', 'commentsFull', 'qualityFull', 'surveyFull', 'continuityFull',
        'commentMinChars', 'commentMinIntervalSec', 'qualityMinChars', 'slotMinutes'];

    function buildWeightInputs() {
        const container = $('weight_inputs');
        container.innerHTML = '';
        S.INDICATORS.forEach(({ key, label }) => {
            const col = document.createElement('div');
            col.className = 'col-6 col-md-4 col-lg';
            col.innerHTML = `<label class="form-label" for="weight_${key}"></label>
                <input type="number" class="form-control form-control-sm" id="weight_${key}" min="0" step="1">`;
            col.querySelector('label').textContent = label;
            container.appendChild(col);
            col.querySelector('input').addEventListener('input', e => {
                settings.weights[key] = Math.max(0, Number(e.target.value) || 0);
                onSettingsChanged();
            });
        });
    }

    function renderSettings() {
        S.INDICATORS.forEach(({ key }) => { $(`weight_${key}`).value = settings.weights[key]; });
        NUMBER_SETTINGS.forEach(key => { $(`set_${key}`).value = settings[key]; });
        $('set_defaultNames').value = settings.defaultNames.join('\n');
        $('set_fillNamesFromOtherSessions').checked = settings.fillNamesFromOtherSessions;
        renderWeightTotal();
    }

    function renderWeightTotal() {
        const total = S.INDICATORS.reduce((sum, { key }) => sum + settings.weights[key], 0);
        $('weight_total').textContent = `（合計 ${total}。合計で割るので100でなくても構いません）`;
    }

    function bindSettings() {
        NUMBER_SETTINGS.forEach(key => {
            $(`set_${key}`).addEventListener('input', e => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || e.target.value === '') return;
                settings[key] = value;
                onSettingsChanged();
            });
        });
        $('set_defaultNames').addEventListener('input', e => {
            settings.defaultNames = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
            onSettingsChanged();
        });
        $('set_fillNamesFromOtherSessions').addEventListener('change', e => {
            settings.fillNamesFromOtherSessions = e.target.checked;
            onSettingsChanged();
        });
        $('button_reset_settings').addEventListener('click', () => {
            settings = S.cloneSettings(S.DEFAULT_SETTINGS);
            renderSettings();
            onSettingsChanged();
        });
    }

    function onSettingsChanged() {
        saveSettings();
        renderWeightTotal();
        recompute();
    }

    // ---------- ファイル ----------

    async function addFiles(fileList) {
        // 選択欄を空にすると FileList も空になるので、先に配列にしておく
        for (const file of [...fileList]) {
            const text = await file.text();
            const { events, invalid } = S.parseJsonl(text);
            files = files.filter(f => f.name !== file.name);
            files.push({ name: file.name, events, invalid });
        }
        rebuildSessions();
    }

    function renderFileList() {
        const list = $('file_list');
        list.innerHTML = '';
        files.forEach(f => {
            const li = document.createElement('li');
            li.className = 'd-flex align-items-center gap-2 py-1';
            const icon = document.createElement('i');
            icon.className = 'bi bi-file-earmark-text';
            const name = document.createElement('span');
            name.textContent = f.name;
            const meta = document.createElement('span');
            meta.className = 'text-body-secondary';
            meta.textContent = `${f.events.length} 件${f.invalid ? `（読めない行 ${f.invalid}）` : ''}`;
            const remove = document.createElement('button');
            remove.className = 'btn btn-sm btn-link text-danger p-0 ms-1';
            remove.title = '外す';
            remove.innerHTML = '<i class="bi bi-x-circle"></i>';
            remove.addEventListener('click', () => {
                files = files.filter(x => x !== f);
                rebuildSessions();
            });
            li.append(icon, name, meta, remove);
            list.appendChild(li);
        });
        $('button_clear_files').classList.toggle('d-none', files.length === 0);
    }

    function rebuildSessions() {
        sessions = S.groupSessions(files.flatMap(f => f.events));
        sessions.forEach(s => {
            const edit = sessionEdits[s.key] || {};
            s.include = edit.include !== false;
            s.start = Number.isFinite(edit.start) ? edit.start : undefined;
            s.end = Number.isFinite(edit.end) ? edit.end : undefined;
        });
        renderFileList();
        renderSessions();
        ['card_sessions', 'card_settings', 'card_results', 'card_method'].forEach(id => {
            $(id).classList.toggle('d-none', sessions.length === 0);
        });
        recompute();
    }

    // ---------- 授業回 ----------

    const pad = n => String(n).padStart(2, '0');
    const timeOf = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
    const minutes = ms => `${Math.round(ms / 60000)} 分`;

    // 授業回の日付のまま時刻だけ変える
    function withTime(baseMs, hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        const d = new Date(baseMs);
        d.setHours(h, m, 0, 0);
        return d.getTime();
    }

    function renderSessions() {
        const rooms = [...new Set(sessions.map(s => s.room))];
        const warning = $('room_warning');
        warning.classList.toggle('d-none', rooms.length <= 1);
        warning.textContent = `複数の部屋の授業ログが含まれています（${rooms.join('、')}）。別の授業を混ぜていないか確認し、不要な授業回はチェックを外してください。`;

        const body = $('session_table');
        body.innerHTML = '';
        sessions.forEach(s => {
            const participants = new Set(s.events.filter(ev => ev.actor === 'participant' && ev.participant_id)
                .map(ev => ev.participant_id)).size;
            const surveys = s.events.filter(ev => ev.type === 'survey_start').length;
            const start = Number.isFinite(s.start) ? s.start : s.autoStart;
            const end = Number.isFinite(s.end) ? s.end : s.autoEnd;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input class="form-check-input" type="checkbox"></td>
                <td class="text-nowrap"></td>
                <td></td>
                <td><input type="time" class="form-control form-control-sm" style="width: 7rem;"></td>
                <td><input type="time" class="form-control form-control-sm" style="width: 7rem;"></td>
                <td class="num"></td>
                <td class="num"></td>
                <td class="num"></td>`;
            const cells = tr.children;
            const include = cells[0].querySelector('input');
            include.checked = s.include;
            cells[1].textContent = `${dateOf(s.autoStart)}（${s.sessionId}）`;
            cells[2].textContent = s.room;
            const startInput = cells[3].querySelector('input');
            const endInput = cells[4].querySelector('input');
            startInput.value = timeOf(start);
            endInput.value = timeOf(end);
            cells[5].textContent = minutes(end - start);
            cells[6].textContent = participants;
            cells[7].textContent = surveys;

            const edit = () => (sessionEdits[s.key] = sessionEdits[s.key] || {});
            include.addEventListener('change', () => {
                s.include = include.checked;
                edit().include = include.checked;
                recompute();
            });
            const onTime = (input, field, auto) => {
                input.addEventListener('change', () => {
                    const value = input.value ? withTime(auto, input.value) : undefined;
                    s[field] = value;
                    edit()[field] = value;
                    const st = Number.isFinite(s.start) ? s.start : s.autoStart;
                    const en = Number.isFinite(s.end) ? s.end : s.autoEnd;
                    cells[5].textContent = minutes(en - st);
                    recompute();
                });
            };
            onTime(startInput, 'start', s.autoStart);
            onTime(endInput, 'end', s.autoEnd);
            body.appendChild(tr);
        });
    }

    // ---------- 計算と表示 ----------

    function recompute() {
        if (sessions.length === 0) {
            result = null;
            $('card_unlinked').classList.add('d-none');
            return;
        }
        result = S.analyze(sessions, settings);
        renderStats();
        renderResults();
        renderUnlinked();
        renderMethod();
    }

    const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
    const fixed = v => (Math.round(v * 10) / 10).toFixed(1);

    function renderStats() {
        const tiles = $('stat_tiles');
        const students = result.summary;
        const avg = students.length ? students.reduce((a, s) => a + s.score, 0) / students.length : 0;
        const unlinkedPids = new Set(result.unlinked.flatMap(u => u.result.pids)).size;
        const items = [
            ['参加者（名前あり）', `${students.length} 人`],
            ['授業回', `${result.sessions.length} 回`],
            ['参画度の平均', students.length ? `${fixed(avg)} 点` : '—'],
            ['名前と結び付かなかったブラウザ', `${unlinkedPids}`]
        ];
        tiles.innerHTML = '';
        items.forEach(([label, value]) => {
            const col = document.createElement('div');
            col.className = 'col-6 col-md-3';
            col.innerHTML = '<div class="stat-tile border rounded p-2 h-100"><div class="small text-body-secondary"></div><div class="value"></div></div>';
            col.querySelector('.small').textContent = label;
            col.querySelector('.value').textContent = value;
            tiles.appendChild(col);
        });
    }

    const COLUMNS = [
        { key: 'name', label: '学修番号', get: s => s.name },
        { key: 'score', label: '参画度', get: s => s.score, num: true },
        { key: 'attended', label: '出席', get: s => s.attended, num: true },
        ...S.INDICATORS.map(({ key, label }) => ({ key, label, get: s => s.indicators[key], num: true, indicator: true })),
        { key: 'warnings', label: '注意', get: s => s.warnings.length }
    ];

    function compareNames(a, b) {
        return String(a).localeCompare(String(b), 'ja', { numeric: true });
    }

    function renderResults() {
        const head = $('result_head');
        head.innerHTML = '';
        const tr = document.createElement('tr');
        COLUMNS.forEach(col => {
            const th = document.createElement('th');
            th.className = `sortable${col.num ? ' num' : ''}${sort.key === col.key ? ' sorted' : ''}`;
            th.textContent = col.label + ' ';
            const icon = document.createElement('i');
            icon.className = `bi ${sort.key === col.key && sort.dir < 0 ? 'bi-caret-down-fill' : 'bi-caret-up-fill'}`;
            th.appendChild(icon);
            th.addEventListener('click', () => {
                sort = sort.key === col.key ? { key: col.key, dir: -sort.dir } : { key: col.key, dir: col.num ? -1 : 1 };
                renderResults();
            });
            tr.appendChild(th);
        });
        head.appendChild(tr);

        const query = $('input_search').value.trim().toLowerCase();
        const col = COLUMNS.find(c => c.key === sort.key);
        const rows = result.summary
            .filter(s => !query || s.name.toLowerCase().includes(query))
            .sort((a, b) => {
                const va = col.get(a);
                const vb = col.get(b);
                const diff = col.key === 'name' ? compareNames(va, vb) : (va ?? -1) - (vb ?? -1);
                return diff * sort.dir || compareNames(a.name, b.name);
            });

        const body = $('result_body');
        body.innerHTML = '';
        if (rows.length === 0) {
            body.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="text-center text-body-secondary py-3">該当する参加者はいません</td></tr>`;
            return;
        }
        rows.forEach(s => {
            const row = document.createElement('tr');
            row.className = 'student-row';
            COLUMNS.forEach(c => {
                const td = document.createElement('td');
                if (c.num) td.className = 'num';
                if (c.key === 'name') {
                    const caret = document.createElement('i');
                    caret.className = `bi ${expanded.has(s.name) ? 'bi-chevron-down' : 'bi-chevron-right'} small me-1 text-body-secondary`;
                    td.append(caret, document.createTextNode(s.name));
                } else if (c.key === 'score') {
                    td.innerHTML = '<span class="fw-semibold"></span><span class="score-bar"><span></span></span>';
                    td.querySelector('.fw-semibold').textContent = fixed(s.score);
                    td.querySelector('.score-bar > span').style.width = `${Math.max(0, Math.min(100, s.score))}%`;
                } else if (c.key === 'attended') {
                    td.textContent = `${s.attended} / ${s.sessions}`;
                } else if (c.indicator) {
                    td.textContent = pct(s.indicators[c.key]);
                } else if (c.key === 'warnings') {
                    s.warnings.forEach(w => {
                        const badge = document.createElement('span');
                        badge.className = `badge ${WARNING_BADGES[w].cls} me-1`;
                        badge.textContent = WARNING_BADGES[w].label;
                        td.appendChild(badge);
                    });
                }
                row.appendChild(td);
            });
            row.addEventListener('click', () => {
                if (expanded.has(s.name)) expanded.delete(s.name);
                else expanded.add(s.name);
                renderResults();
            });
            body.appendChild(row);
            if (expanded.has(s.name)) body.appendChild(detailRow(s));
        });
    }

    // 授業回ごとの内訳
    function detailRow(student) {
        const tr = document.createElement('tr');
        tr.className = 'detail-row';
        const td = document.createElement('td');
        td.colSpan = COLUMNS.length;
        const table = document.createElement('table');
        table.className = 'table table-sm table-borderless mb-0 small';
        table.innerHTML = `<thead><tr>
            <th>授業回</th><th class="num">点</th><th class="num">滞在</th><th class="num">有効コメント</th>
            <th class="num">実質コメント</th><th class="num">アンケート回答</th><th class="num">活動区間</th><th>メモ</th>
        </tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        result.sessions.forEach((sr, i) => {
            const r = student.perSession[i];
            const row = document.createElement('tr');
            const cells = [`${dateOf(sr.start)} ${timeOf(sr.start)}`];
            if (!r || !r.present) {
                cells.push('0.0', '欠席', '', '', '', '', '');
            } else {
                const d = r.details;
                const memo = [];
                if (r.pids.length > 1) memo.push(`${r.pids.length}台のブラウザ`);
                if (r.otherNames.length) memo.push(`同じブラウザの別名: ${r.otherNames.join(', ')}`);
                if (r.estimated) memo.push('名前を他の回から補完');
                cells.push(
                    fixed(r.score),
                    pct(r.raw.presence),
                    `${d.validComments}（全${d.allComments}）`,
                    `${r.raw.quality}`,
                    d.surveysEligible ? `${d.surveysAnswered} / ${d.surveysEligible}` : '—',
                    `${d.activeSlots} / ${d.slotCount}`,
                    memo.join('、')
                );
            }
            cells.forEach((text, j) => {
                const cell = document.createElement('td');
                if (j > 0 && j < 7) cell.className = 'num';
                cell.textContent = text;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        td.appendChild(table);
        tr.appendChild(td);
        return tr;
    }

    function renderUnlinked() {
        const body = $('unlinked_body');
        body.innerHTML = '';
        $('card_unlinked').classList.toggle('d-none', result.unlinked.length === 0);
        $('unlinked_count').textContent = result.unlinked.length;
        result.unlinked.forEach(({ session, result: r }) => {
            const tr = document.createElement('tr');
            [
                `${dateOf(session.start)} ${timeOf(session.start)}`,
                r.pids.map(p => p.slice(0, 8)).join(', '),
                pct(r.raw.presence),
                `${r.details.allComments}`,
                `${r.details.surveysAnswered}`
            ].forEach((text, i) => {
                const td = document.createElement('td');
                if (i >= 2) td.className = 'num';
                td.textContent = text;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    // 学生に示せる計算方法の説明（現在の設定から作る）
    function methodText() {
        const w = settings.weights;
        const total = S.INDICATORS.reduce((sum, { key }) => sum + w[key], 0) || 1;
        const share = key => `${Math.round(w[key] / total * 1000) / 10}%`;
        return [
            '授業参画度は、授業回ごとに次の5つの指標を0〜1に換算し、重みを付けて平均したものです（100点満点）。',
            '',
            `・滞在（重み ${share('presence')}）：授業時間のうち在室していた割合。${settings.presenceFull}%以上で満点。`,
            `・発言（重み ${share('comments')}）：有効なコメントの数。${settings.commentsFull}件以上で満点。`,
            `・質（重み ${share('quality')}）：記号・絵文字・「w」「草」などを除いた本文が${settings.qualityMinChars}文字以上の有効なコメントの数。${settings.qualityFull}件以上で満点。`,
            `・アンケート回答率（重み ${share('survey')}）：在室中に行われたアンケートのうち回答した割合。${settings.surveyFull}%以上で満点。アンケートがなかった回は、この指標を除いて計算します。`,
            `・継続性（重み ${share('continuity')}）：授業を${settings.slotMinutes}分ごとに区切り、コメントかアンケート回答をした区間の割合。${settings.continuityFull}%以上で満点。`,
            '',
            `有効なコメント：${settings.commentMinChars}文字以上で、自分の直前のコメントと同じ文ではなく、直前の有効なコメントから${settings.commentMinIntervalSec}秒以上あいているもの。`,
            '複数の授業回の参画度は、欠席した回を0点として全授業回で平均します。',
            '本人の確認には名前欄の入力（学修番号）を使います。名前を入力していない、または「匿名」のままの参加は集計されません。'
        ].join('\n');
    }

    function renderMethod() {
        $('method_text').textContent = methodText();
    }

    // ---------- CSV ----------

    function csvEscape(value) {
        const s = String(value ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    function settingsRows() {
        return [
            [],
            ['設定'],
            ...S.INDICATORS.map(({ key, label }) => [`重み：${label}`, settings.weights[key]]),
            ['満点：在室率(%)', settings.presenceFull],
            ['満点：有効コメント数', settings.commentsFull],
            ['満点：実質コメント数', settings.qualityFull],
            ['満点：回答率(%)', settings.surveyFull],
            ['満点：活動区間(%)', settings.continuityFull],
            ['有効コメントの最低文字数', settings.commentMinChars],
            ['有効コメントの間隔(秒)', settings.commentMinIntervalSec],
            ['実質コメントの文字数', settings.qualityMinChars],
            ['継続性の区間(分)', settings.slotMinutes],
            ['名前として扱わない値', settings.defaultNames.join(' / ')],
            ['他の回の名前で補う', settings.fillNamesFromOtherSessions ? 'はい' : 'いいえ'],
            ['授業回', result.sessions.map(sr => `${sr.sessionId}(${timeOf(sr.start)}-${timeOf(sr.end)})`).join(' ')]
        ];
    }

    function downloadCsv(rows, filename) {
        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function filePrefix() {
        const rooms = [...new Set(result.sessions.map(s => s.room).filter(Boolean))];
        const first = result.sessions[0];
        const last = result.sessions[result.sessions.length - 1];
        const range = first === last ? first.sessionId : `${first.sessionId}_${last.sessionId}`;
        return `${rooms.length === 1 ? rooms[0] + '_' : ''}engagement_${range}`;
    }

    const round1 = v => (v === null || v === undefined ? '' : Math.round(v * 1000) / 10);
    const sortedStudents = () => [...result.summary].sort((a, b) => compareNames(a.name, b.name));

    function downloadSummary() {
        const header = ['学修番号', '参画度', '出席回数', '授業回数',
            ...S.INDICATORS.map(({ label }) => `${label}(%)`), '注意',
            ...result.sessions.map(sr => `点:${sr.sessionId}`)];
        const rows = sortedStudents().map(s => [
            s.name, fixed(s.score), s.attended, s.sessions,
            ...S.INDICATORS.map(({ key }) => round1(s.indicators[key])),
            s.warnings.map(w => WARNING_BADGES[w].label).join(' '),
            ...s.perSession.map(r => (r && r.present ? fixed(r.score) : 0))
        ]);
        downloadCsv([header, ...rows, ...settingsRows()], `${filePrefix()}_summary.csv`);
    }

    function downloadDetail() {
        const header = ['学修番号', '授業回', '開始', '終了', '出欠', '点',
            '在室率(%)', '全コメント数', '有効コメント数', '実質コメント数',
            '対象アンケート数', '回答数', '回答率(%)', '活動区間数', '区間数',
            ...S.INDICATORS.map(({ label }) => `換算:${label}(%)`),
            'ブラウザID', '同じブラウザの別名', '名前を補完'];
        const rows = [];
        sortedStudents().forEach(s => {
            result.sessions.forEach((sr, i) => {
                const r = s.perSession[i];
                const base = [s.name, sr.sessionId, new Date(sr.start).toLocaleString('ja-JP'), new Date(sr.end).toLocaleString('ja-JP')];
                if (!r || !r.present) {
                    rows.push([...base, '欠席', 0]);
                    return;
                }
                const d = r.details;
                rows.push([...base, '出席', fixed(r.score),
                    round1(r.raw.presence), d.allComments, d.validComments, r.raw.quality,
                    d.surveysEligible, d.surveysAnswered, round1(r.raw.survey), d.activeSlots, d.slotCount,
                    ...S.INDICATORS.map(({ key }) => round1(r.normalized[key])),
                    r.pids.join(' '), r.otherNames.join(' / '), r.estimated ? 'はい' : '']);
            });
        });
        downloadCsv([header, ...rows, ...settingsRows()], `${filePrefix()}_detail.csv`);
    }

    // ---------- 初期化 ----------

    function init() {
        buildWeightInputs();
        renderSettings();
        bindSettings();

        const dropZone = $('drop_zone');
        ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }));
        dropZone.addEventListener('drop', e => addFiles(e.dataTransfer.files));
        // ドロップし損ねたファイルをブラウザが開いてしまわないように
        window.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('drop', e => e.preventDefault());
        $('input_files').addEventListener('change', e => {
            addFiles(e.target.files);
            e.target.value = '';
        });
        $('button_clear_files').addEventListener('click', () => {
            files = [];
            sessionEdits = {};
            rebuildSessions();
        });

        $('input_search').addEventListener('input', () => result && renderResults());
        $('button_csv_summary').addEventListener('click', () => result && downloadSummary());
        $('button_csv_detail').addEventListener('click', () => result && downloadDetail());
        $('button_copy_method').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(methodText());
                $('button_copy_method').innerHTML = '<i class="bi bi-check2"></i> コピーしました';
                setTimeout(() => { $('button_copy_method').innerHTML = '<i class="bi bi-clipboard"></i> コピー'; }, 1500);
            } catch (e) {
                alert('コピーできませんでした。文章を選択してコピーしてください。');
            }
        });
    }

    init();
})();
