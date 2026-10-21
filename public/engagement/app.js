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
    const openCharts = new Set();    // グラフを開いている授業回のキー
    const chartBinMinutes = {};      // 授業回のキー → 集計の幅（分）

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
        // 「授業開始」で始めた回があれば、それ以外（授業前の動作確認など）は初めから外す
        const hasClass = sessions.some(s => s.isClass);
        sessions.forEach(s => {
            const edit = sessionEdits[s.key] || {};
            s.include = typeof edit.include === 'boolean' ? edit.include : (!hasClass || s.isClass);
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
                <td class="num"></td>
                <td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary text-nowrap"></button></td>`;
            const cells = tr.children;
            const include = cells[0].querySelector('input');
            include.checked = s.include;
            cells[1].textContent = `${dateOf(s.autoStart)}（${s.sessionId}）`;
            if (!s.isClass) {
                const badge = el('span', 'badge text-bg-secondary ms-1');
                badge.textContent = '授業外';
                badge.title = 'ダッシュボードの「授業開始」で始めた回ではありません';
                cells[1].appendChild(badge);
            }
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
                    if (openCharts.has(s.key)) renderSessions();
                    recompute();
                });
            };
            onTime(startInput, 'start', s.autoStart);
            onTime(endInput, 'end', s.autoEnd);

            // 盛り上がりのグラフ（授業回が多いと邪魔になるので、ボタンで開く）
            const chartButton = cells[8].querySelector('button');
            const setButton = () => {
                chartButton.innerHTML = openCharts.has(s.key)
                    ? '<i class="bi bi-chevron-up"></i> 閉じる'
                    : '<i class="bi bi-bar-chart-line"></i> グラフ';
                chartButton.setAttribute('aria-expanded', openCharts.has(s.key));
            };
            setButton();
            chartButton.addEventListener('click', () => {
                if (openCharts.has(s.key)) openCharts.delete(s.key);
                else openCharts.add(s.key);
                renderSessions();
            });
            body.appendChild(tr);
            if (openCharts.has(s.key)) body.appendChild(sessionChartRow(s));
        });
    }

    // ---------- 授業回の盛り上がりグラフ ----------

    const ACTIVITY_SERIES = [
        { key: 'comments', label: 'コメント', cls: 'sc-comments' },
        { key: 'reactions', label: 'リアクション', cls: 'sc-reactions' },
        { key: 'answers', label: 'アンケート回答', cls: 'sc-answers' }
    ];

    // 目盛りのきりのよい上限（1・2・5 × 10^n）
    function niceMax(value) {
        if (value <= 0) return 1;
        const exp = Math.pow(10, Math.floor(Math.log10(value)));
        return [1, 2, 5, 10].map(m => m * exp).find(v => v >= value);
    }

    function autoBinMinutes(duration) {
        const min = duration / 60000;
        return min <= 30 ? 1 : min <= 120 ? 2 : 5;
    }

    function sessionChartRow(session) {
        const tr = el('tr', 'session-chart-row');
        const td = el('td');
        td.colSpan = 9;
        tr.appendChild(td);
        // 表が横にスクロールしても、グラフは見えている幅に収める
        const cell = el('div', 'fit-visible');
        td.appendChild(cell);

        const start = Number.isFinite(session.start) ? session.start : session.autoStart;
        const end = Number.isFinite(session.end) ? session.end : session.autoEnd;
        const binMinutes = chartBinMinutes[session.key] || autoBinMinutes(end - start);
        const data = S.sessionActivity(session, binMinutes * 60000);
        const n = data.bins.length;
        const duration = Math.max(1, data.end - data.start);
        const pos = t => Math.max(0, Math.min(100, (t - data.start) / duration * 100));

        // 見出し：集計の幅と凡例
        const head = el('div', 'd-flex flex-wrap gap-3 align-items-center mb-2');
        const binLabel = el('label', 'small d-flex align-items-center gap-1', '集計の幅');
        const binSelect = el('select', 'form-select form-select-sm w-auto');
        [1, 2, 5, 10].forEach(m => {
            const option = el('option', '', `${m}分`);
            option.value = m;
            option.selected = m === binMinutes;
            binSelect.appendChild(option);
        });
        binSelect.addEventListener('change', () => {
            chartBinMinutes[session.key] = Number(binSelect.value);
            renderSessions();
        });
        binLabel.appendChild(binSelect);
        const legend = el('div', 'tl-legend mt-0');
        ACTIVITY_SERIES.forEach(series => {
            const item = el('span', 'tl-legend-item');
            item.append(el('span', `tl-key sc-key ${series.cls}`), document.createTextNode(series.label));
            legend.appendChild(item);
        });
        if (data.surveys.length) {
            const item = el('span', 'tl-legend-item');
            item.append(el('span', 'tl-key tl-key-survey'), document.createTextNode('アンケート実施中'));
            legend.appendChild(item);
        }
        const totals = ACTIVITY_SERIES.map(sr => `${sr.label} ${data.bins.reduce((a, b) => a + b[sr.key], 0)}`).join(' ／ ');
        head.append(binLabel, legend, el('span', 'small text-body-secondary ms-auto', `合計：${totals}`));
        cell.appendChild(head);

        // 投稿数（積み上げ棒）
        const maxTotal = Math.max(0, ...data.bins.map(b => b.comments + b.reactions + b.answers));
        const yMax = niceMax(maxTotal);
        const chart = el('div', 'sc');
        chart.appendChild(yAxis([yMax, yMax / 2, 0], `件/${binMinutes}分`));
        const plot = el('div', 'sc-plot');
        [0, 50, 100].forEach(p => {
            const line = el('div', `sc-grid${p === 0 ? ' base' : ''}`);
            line.style.bottom = `${p}%`;
            plot.appendChild(line);
        });
        data.surveys.forEach(sv => {
            const band = el('div', 'sc-survey');
            band.style.left = `${pos(sv.start)}%`;
            band.style.width = `${Math.max(0.5, pos(sv.end) - pos(sv.start))}%`;
            plot.appendChild(band);
        });
        const bars = el('div', `sc-bars${n > 60 ? ' dense' : ''}`);
        data.bins.forEach(bin => {
            const col = el('div', 'sc-col');
            // 最後の区間が短いときは、その分だけ細くする
            col.style.flexGrow = (bin.end - bin.start) / data.binMs;
            const stack = el('div', 'sc-stack');
            ACTIVITY_SERIES.forEach(series => {
                if (!bin[series.key]) return;
                const seg = el('div', `sc-seg ${series.cls}`);
                seg.style.height = `${bin[series.key] / yMax * 100}%`;
                stack.appendChild(seg);
            });
            col.appendChild(stack);
            bars.appendChild(col);
        });
        plot.appendChild(bars);
        chart.appendChild(plot);
        cell.appendChild(chart);

        // 在室者数（別の目盛りなので別のグラフにする）
        const maxPresent = niceMax(Math.max(0, ...data.bins.map(b => b.present)));
        const chart2 = el('div', 'sc sc-small');
        chart2.appendChild(yAxis([maxPresent, 0], '在室（人）'));
        const plot2 = el('div', 'sc-plot');
        [0, 100].forEach(p => {
            const line = el('div', `sc-grid${p === 0 ? ' base' : ''}`);
            line.style.bottom = `${p}%`;
            plot2.appendChild(line);
        });
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${duration} ${maxPresent}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('sc-line');
        let d = '';
        data.bins.forEach((bin, i) => {
            const x0 = bin.start - data.start;
            const x1 = bin.end - data.start;
            const y = maxPresent - bin.present;
            d += `${i === 0 ? 'M' : 'L'}${x0},${y}L${x1},${y}`;
        });
        const area = document.createElementNS(svgNS, 'path');
        area.setAttribute('d', `${d}L${duration},${maxPresent}L0,${maxPresent}Z`);
        area.setAttribute('class', 'sc-area');
        const line = document.createElementNS(svgNS, 'path');
        line.setAttribute('d', d);
        line.setAttribute('class', 'sc-stroke');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(area, line);
        plot2.appendChild(svg);
        chart2.appendChild(plot2);
        cell.appendChild(chart2);

        // 時間軸
        const axisWrap = el('div', 'sc sc-axis-row');
        axisWrap.appendChild(el('div', 'sc-y'));
        const axis = el('div', 'tl-axis sc-axis');
        const totalMin = Math.ceil(duration / 60000);
        // ラベルが重ならないよう、表示幅に合わせて目盛りの数を決める（1つあたり約60px）
        const maxTicks = Math.max(3, Math.min(9, Math.floor(($('card_sessions').clientWidth - 120) / 60)));
        const tickStep = [5, 10, 15, 30, 60].find(m => totalMin / m <= maxTicks) || 120;
        for (let m = 0; m <= totalMin; m += tickStep) {
            const tick = el('div', `tl-tick${m === 0 ? ' first' : ''}`, `+${m}分`);
            tick.style.left = `${pos(data.start + m * 60000)}%`;
            if (m > 0 && pos(data.start + m * 60000) > 95) tick.classList.add('last');
            axis.appendChild(tick);
        }
        axisWrap.appendChild(axis);
        cell.appendChild(axisWrap);

        bindSessionChartHover([plot, plot2], data);

        // 表で見る
        const details = el('details', 'tl-list');
        details.appendChild(el('summary', 'small', '表で見る'));
        const table = el('table', 'table table-sm table-borderless small mb-0');
        table.innerHTML = '<thead><tr><th>時刻</th><th class="num">コメント</th><th class="num">リアクション</th><th class="num">アンケート回答</th><th class="num">在室</th><th>コメントの例</th></tr></thead><tbody></tbody>';
        const tbody = table.querySelector('tbody');
        data.bins.forEach(bin => {
            const row = el('tr');
            row.append(
                el('td', 'num', `${timeOf(bin.start)}〜`),
                el('td', 'num', bin.comments), el('td', 'num', bin.reactions), el('td', 'num', bin.answers),
                el('td', 'num', bin.present),
                el('td', 'text-break', bin.texts.slice(0, 3).join(' ／ '))
            );
            tbody.appendChild(row);
        });
        details.appendChild(table);
        cell.appendChild(details);
        return tr;
    }

    function yAxis(values, unit) {
        const axis = el('div', 'sc-y');
        values.forEach((v, i) => {
            const label = el('div', 'sc-y-label', String(v));
            label.style.bottom = `${(values.length - 1 - i) / (values.length - 1) * 100}%`;
            axis.appendChild(label);
        });
        axis.appendChild(el('div', 'sc-y-unit', unit));
        return axis;
    }

    // ポインタのある区間の内訳をツールチップに出す（2つのグラフで同じ区間を強調する）
    function bindSessionChartHover(plots, data) {
        const n = data.bins.length;
        const duration = Math.max(1, data.end - data.start);
        const highlights = plots.map(plot => {
            const h = el('div', 'sc-hover d-none');
            plot.appendChild(h);
            return h;
        });
        const hide = () => {
            highlights.forEach(h => h.classList.add('d-none'));
            tooltip.classList.add('d-none');
        };
        const move = e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const t = data.start + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
            const i = Math.min(n - 1, Math.floor((t - data.start) / data.binMs));
            const bin = data.bins[i];
            const left = (bin.start - data.start) / duration * 100;
            const width = (bin.end - bin.start) / duration * 100;
            highlights.forEach(h => {
                h.style.left = `${left}%`;
                h.style.width = `${width}%`;
                h.classList.remove('d-none');
            });

            tooltip.textContent = '';
            tooltip.appendChild(el('div', 'fw-semibold', `${timeOf(bin.start)}〜${timeOf(bin.end)}（+${Math.round((bin.start - data.start) / 60000)}分）`));
            ACTIVITY_SERIES.forEach(series => {
                const row = el('div', 'tl-tip-row align-items-center');
                row.append(el('span', `tl-key sc-key ${series.cls}`), el('span', 'fw-semibold', bin[series.key]), el('span', 'text-body-secondary', series.label));
                tooltip.appendChild(row);
            });
            tooltip.appendChild(el('div', 'text-body-secondary', `在室 ${bin.present} 人`));
            const survey = data.surveys.find(sv => sv.start < bin.end && sv.end > bin.start);
            if (survey) tooltip.appendChild(el('div', 'text-body-secondary', `アンケート：${survey.question || ''}`));
            bin.texts.slice(0, 4).forEach(text => {
                tooltip.appendChild(el('div', 'text-break small mt-1', `「${text.length > 60 ? text.slice(0, 60) + '…' : text}」`));
            });
            if (bin.texts.length > 4) tooltip.appendChild(el('div', 'text-body-secondary small', `ほか ${bin.texts.length - 4} 件`));
            showTooltip(e.clientX, e.clientY);
        };
        plots.forEach(plot => {
            plot.addEventListener('pointermove', move);
            plot.addEventListener('pointerdown', move);
            plot.addEventListener('pointerleave', hide);
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
        const cell = el('div', 'fit-visible');
        const scroller = el('div', 'overflow-x-auto');
        scroller.appendChild(table);
        cell.appendChild(scroller);
        td.appendChild(cell);
        const attended = result.sessions.map((sr, i) => [sr, student.perSession[i]]).filter(([, r]) => r && r.present);
        if (attended.length) {
            // 凡例は授業回ごとに繰り返さず、タイムラインの最初に1回だけ出す
            const legend = timelineLegend(attended.some(([sr]) => sr.surveyPeriods.length > 0));
            legend.classList.add('timeline-legend-top');
            cell.appendChild(legend);
        }
        attended.forEach(([sr, r]) => cell.appendChild(timelineBlock(sr, r)));
        tr.appendChild(td);
        return tr;
    }

    // ---------- タイムライン ----------

    const COMMENT_STATUS = {
        substantive: { label: '実質', marker: 'tl-mark-substantive' },
        valid: { label: '有効', marker: 'tl-mark-valid' },
        invalid: { label: '無効', marker: 'tl-mark-invalid' }
    };
    const INVALID_REASON = { short: '短すぎる', duplicate: '直前と同じ文', rapid: '連打' };
    const elapsedLabel = ms => `+${Math.floor(ms / 60000)}分`;
    const clockOf = ms => { const d = new Date(ms); return `${timeOf(ms)}:${pad(d.getSeconds())}`; };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // 1回分のタイムライン（活動区間・在室・コメント・アンケート回答）と投稿の一覧
    function timelineBlock(sr, r) {
        const tl = r.timeline;
        const duration = Math.max(1, sr.end - sr.start);
        const pos = t => Math.max(0, Math.min(100, (t - sr.start) / duration * 100));

        const block = el('div', 'timeline-block');
        const title = el('div', 'd-flex flex-wrap gap-2 align-items-baseline mb-1');
        title.append(
            el('span', 'fw-semibold', `${dateOf(sr.start)} ${timeOf(sr.start)}〜${timeOf(sr.end)}`),
            el('span', 'text-body-secondary', `${fixed(r.score)} 点 ／ 活動区間 ${tl.activeSlots.length} / ${sr.slotCount}`)
        );
        block.appendChild(title);

        const chart = el('div', 'tl');
        const labels = el('div', 'tl-labels');
        const tracks = el('div', 'tl-tracks');
        chart.append(labels, tracks);

        const addRow = (label, track) => {
            labels.appendChild(el('div', `tl-label ${track.dataset.size}`, label));
            tracks.appendChild(track);
        };

        // 活動区間：区間ごとのセル（活動あり／なし）
        const slots = el('div', 'tl-track tl-slots');
        slots.dataset.size = 'tl-h-slot';
        const active = new Set(tl.activeSlots);
        for (let k = 0; k < sr.slotCount; k++) {
            const cell = el('div', `tl-slot${active.has(k) ? ' active' : ''}`);
            // 最後の区間は授業の終わりまで（長さが違うことがある）
            const slotEnd = k === sr.slotCount - 1 ? sr.end : sr.start + (k + 1) * sr.slotMs;
            cell.style.flexGrow = (slotEnd - (sr.start + k * sr.slotMs)) / sr.slotMs;
            slots.appendChild(cell);
        }
        addRow('活動区間', slots);

        // 在室
        const presence = el('div', 'tl-track tl-presence');
        presence.dataset.size = 'tl-h-bar';
        tl.intervals.forEach(([a, b]) => {
            const bar = el('div', 'tl-bar');
            bar.style.left = `${pos(a)}%`;
            bar.style.width = `${Math.max(0.3, pos(b) - pos(a))}%`;
            presence.appendChild(bar);
        });
        addRow('在室', presence);

        // コメント
        const comments = el('div', 'tl-track tl-points');
        comments.dataset.size = 'tl-h-point';
        tl.comments.forEach(c => {
            const m = el('div', `tl-mark ${COMMENT_STATUS[c.status].marker}`);
            m.style.left = `${pos(c.t)}%`;
            comments.appendChild(m);
        });
        addRow('コメント', comments);

        // アンケート回答（実施中の期間を背景に敷く）
        const answers = el('div', 'tl-track tl-points');
        answers.dataset.size = 'tl-h-point';
        sr.surveyPeriods.forEach(sp => {
            const band = el('div', 'tl-survey');
            band.style.left = `${pos(sp.start)}%`;
            band.style.width = `${Math.max(0.5, pos(sp.end) - pos(sp.start))}%`;
            answers.appendChild(band);
        });
        tl.answers.forEach(a => {
            const m = el('div', 'tl-mark tl-mark-answer');
            m.style.left = `${pos(a.t)}%`;
            answers.appendChild(m);
        });
        addRow('回答', answers);

        // 時間軸（区間の区切りごと。込み合うときは間引く）
        const axis = el('div', 'tl-axis');
        const step = Math.max(1, Math.ceil(sr.slotCount / 8));
        for (let k = 0; k <= sr.slotCount; k += step) {
            const t = Math.min(sr.start + k * sr.slotMs, sr.end);
            const tick = el('div', 'tl-tick', elapsedLabel(t - sr.start));
            tick.style.left = `${pos(t)}%`;
            if (k === 0) tick.classList.add('first');
            else if (pos(t) > 95) tick.classList.add('last');
            axis.appendChild(tick);
        }
        labels.appendChild(el('div', 'tl-label tl-h-axis'));
        tracks.appendChild(axis);

        const crosshair = el('div', 'tl-crosshair d-none');
        tracks.appendChild(crosshair);
        bindTimelineHover(tracks, crosshair, sr, r);
        block.appendChild(chart);
        block.appendChild(postList(sr, r));
        return block;
    }

    function timelineLegend(withSurvey) {
        const legend = el('div', 'tl-legend');
        const item = (cls, label) => {
            const span = el('span', 'tl-legend-item');
            span.append(el('span', `tl-key ${cls}`), document.createTextNode(label));
            legend.appendChild(span);
        };
        item('tl-key-slot', `活動のあった区間（${settings.slotMinutes}分ごと）`);
        item('tl-key-bar', '在室');
        item('tl-mark tl-mark-substantive', '実質コメント');
        item('tl-mark tl-mark-valid', '有効コメント');
        item('tl-mark tl-mark-invalid', '無効コメント');
        item('tl-mark tl-mark-answer', 'アンケート回答');
        if (withSurvey) item('tl-key-survey', 'アンケート実施中');
        return legend;
    }

    // ポインタ位置の時刻と、その付近の投稿をツールチップに出す
    function bindTimelineHover(tracks, crosshair, sr, r) {
        const tl = r.timeline;
        const duration = Math.max(1, sr.end - sr.start);
        const items = [
            ...tl.comments.map(c => ({ t: c.t, key: COMMENT_STATUS[c.status].marker, text: c.text, note: c.status === 'invalid' ? `無効（${INVALID_REASON[c.reason]}）` : COMMENT_STATUS[c.status].label })),
            ...tl.answers.map(a => ({ t: a.t, key: 'tl-mark-answer', text: a.choices.join(' / '), note: a.question ? `回答：${a.question}` : '回答' }))
        ].sort((a, b) => a.t - b.t);
        const active = new Set(tl.activeSlots);

        const move = e => {
            const rect = tracks.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const t = sr.start + x / rect.width * duration;
            crosshair.style.left = `${x}px`;
            crosshair.classList.remove('d-none');

            const slot = Math.min(sr.slotCount - 1, Math.floor((t - sr.start) / sr.slotMs));
            const present = tl.intervals.some(([a, b]) => t >= a && t <= b);
            // 幅の3%（最低1分）以内の投稿を近いとみなす
            const near = Math.max(60000, duration * 0.03);
            const nearby = items.filter(it => Math.abs(it.t - t) <= near);

            tooltip.textContent = '';
            const head = el('div', 'fw-semibold', `${elapsedLabel(t - sr.start)}（${timeOf(t)}）`);
            const meta = el('div', 'text-body-secondary', `区間${slot + 1}：${active.has(slot) ? '活動あり' : '活動なし'} ／ ${present ? '在室' : '不在'}`);
            tooltip.append(head, meta);
            nearby.slice(0, 5).forEach(it => {
                const row = el('div', 'tl-tip-row');
                row.append(el('span', `tl-key tl-mark ${it.key}`));
                const body = el('div');
                body.append(el('div', 'fw-semibold text-break', it.text.length > 80 ? it.text.slice(0, 80) + '…' : it.text));
                body.append(el('div', 'text-body-secondary', `${clockOf(it.t)} ${it.note}`));
                row.appendChild(body);
                tooltip.appendChild(row);
            });
            if (nearby.length > 5) tooltip.appendChild(el('div', 'text-body-secondary', `ほか ${nearby.length - 5} 件`));
            showTooltip(e.clientX, e.clientY);
        };
        tracks.addEventListener('pointermove', move);
        tracks.addEventListener('pointerdown', move);
        tracks.addEventListener('pointerleave', () => {
            crosshair.classList.add('d-none');
            tooltip.classList.add('d-none');
        });
        // 行の開閉に反応しないように
        tracks.addEventListener('click', e => e.stopPropagation());
    }

    const tooltip = el('div', 'tl-tooltip d-none');
    document.body.appendChild(tooltip);
    function showTooltip(x, y) {
        tooltip.classList.remove('d-none');
        const w = tooltip.offsetWidth;
        const h = tooltip.offsetHeight;
        const left = x + 14 + w > window.innerWidth - 8 ? x - 14 - w : x + 14;
        const top = Math.min(window.innerHeight - h - 8, y + 14);
        tooltip.style.left = `${Math.max(8, left)}px`;
        tooltip.style.top = `${Math.max(8, top)}px`;
    }

    // 投稿・回答の一覧（タイムラインの表形式）
    function postList(sr, r) {
        const tl = r.timeline;
        const rows = [
            ...tl.comments.map(c => ({ t: c.t, marker: COMMENT_STATUS[c.status].marker, label: c.status === 'invalid' ? `無効（${INVALID_REASON[c.reason]}）` : COMMENT_STATUS[c.status].label, text: c.text })),
            ...tl.answers.map(a => ({ t: a.t, marker: 'tl-mark-answer', label: 'アンケート回答', text: [a.question, a.choices.join(' / ')].filter(Boolean).join(' → ') }))
        ].sort((a, b) => a.t - b.t);

        const details = el('details', 'tl-list');
        details.open = rows.length > 0 && rows.length <= 15;
        details.appendChild(el('summary', 'small', `投稿・回答の一覧（${rows.length}件）`));
        if (rows.length === 0) {
            details.appendChild(el('div', 'small text-body-secondary py-1', 'この回の投稿・回答はありません'));
            return details;
        }
        const table = el('table', 'table table-sm table-borderless small mb-0');
        table.innerHTML = '<thead><tr><th>時刻</th><th class="d-none d-sm-table-cell">経過</th><th>判定</th><th>内容</th></tr></thead><tbody></tbody>';
        const tbody = table.querySelector('tbody');
        rows.forEach(row => {
            const tr = el('tr');
            const judge = el('td', 'text-nowrap');
            judge.append(el('span', `tl-key tl-mark ${row.marker}`), document.createTextNode(row.label));
            tr.append(el('td', 'num', clockOf(row.t)), el('td', 'num d-none d-sm-table-cell', elapsedLabel(row.t - sr.start)), judge, el('td', 'text-break', row.text));
            tbody.appendChild(tr);
        });
        details.appendChild(table);
        return details;
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

    // 横スクロールする表の中で、グラフ・詳細を見えている幅に合わせるための幅
    function watchScrollerWidths() {
        if (!window.ResizeObserver) return;
        const observer = new ResizeObserver(entries => {
            entries.forEach(entry => entry.target.style.setProperty('--visible-width', `${entry.target.clientWidth}px`));
        });
        document.querySelectorAll('.table-responsive').forEach(node => observer.observe(node));
    }

    function init() {
        buildWeightInputs();
        renderSettings();
        watchScrollerWidths();
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
