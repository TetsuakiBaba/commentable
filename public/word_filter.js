// 不適切な表現のチェック
// 送信前に、コメントや名前に「入っていたら間違いなく不適切」な語が含まれていないかを調べる
// （以前は伏せ字にしていたが、語が多すぎて「マイク」のような普通の言葉まで伏せ字になっていたので、
//   語を絞った上で、含まれていたら送信させずに直してもらう方式にした）
(function (global) {
    const LIST_URL = '/inappropriate-words-ja/blocklist.base64.txt';

    // 不適切な語を含むが普通に使われる言葉（チェックの前に取り除く）
    const ALLOWED_WORDS = ['パチンコ', 'アナルコ', 'えっちゃん', '金玉均', 'ブルセラ症'];

    // 注音符号を形の似たかなの代わりに使ったすり抜け（例: ちんㄎん）を元の文字に戻す
    const LOOKALIKES = {
        'ㄎ': 'ち', 'ㄘ': 'ち', 'ㄑ': 'く', 'ㄝ': 'せ', 'ㄛ': 'さ', 'ㄜ': 'さ',
        'ㄦ': 'ル', 'ㄨ': 'メ', 'ㄊ': 'ム', 'ㄙ': 'ム', 'ㄌ': 'カ', 'ㄒ': 't'
    };

    let words = [];
    let loading = null;

    // 全角英数・半角カナをそろえ、英字は小文字にする（ひらがなとカタカナは区別する。
    // 区別しないと「ヒューマンコンピュータ」のような言葉まで引っかかるため）
    function normalize(text) {
        let normalized = String(text || '').normalize('NFKC').toLowerCase();
        normalized = normalized.replace(/[㄀-ㄯ]/g, ch => LOOKALIKES[ch] || ch);
        for (const allowed of ALLOWED_WORDS) {
            normalized = normalized.split(allowed.normalize('NFKC').toLowerCase()).join(' ');
        }
        return normalized;
    }

    function decodeBase64(line) {
        const binary = atob(line);
        const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    }

    function load() {
        if (loading) return loading;
        loading = fetch(LIST_URL)
            .then(response => response.ok ? response.text() : '')
            .then(text => {
                words = [...new Set(text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map(line => {
                        try { return decodeBase64(line).normalize('NFKC').toLowerCase(); } catch (e) { return null; }
                    })
                    .filter(Boolean))];
            })
            .catch(error => {
                if (typeof debugError === 'function') debugError('不適切な表現のリストを読み込めませんでした:', error);
            });
        return loading;
    }

    // 含まれている不適切な語の一覧（なければ空の配列）
    function find(text) {
        if (!text || words.length === 0) return [];
        const normalized = normalize(text);
        const found = words.filter(word => normalized.includes(word));
        // 「アナル」と「アナルセックス」のように重なるものは長いほうだけ示す
        return found.filter(word => !found.some(other => other !== word && other.includes(word)));
    }

    global.WordFilter = { load, find };
    load();
})(window);
