// i18next の初期化

document.addEventListener('DOMContentLoaded', function () {
    i18next
        .use(i18nextHttpBackend)
        .use(i18nextBrowserLanguageDetector)
        .init({
            fallbackLng: 'ja',
            load: 'languageOnly',  // 言語コードのみを使用（例：'en'は使用するが'en-US'は使用しない）
            debug: false,
            backend: {
                loadPath: '/locales/{{lng}}/translation.json',
            },
            detection: {
                order: ['navigator', 'htmlTag', 'path', 'subdomain'],
                caches: ['localStorage', 'cookie'],
            }

        }, function (err, t) {
            if (err) return console.error(err);
            updateContent();
            console.log('i18next is ready', t);
        });

});

// 翻訳可能な要素を更新する関数
function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (key.startsWith('[')) {
            // 属性の翻訳
            const match = key.match(/\[(.*?)\](.*)/);
            if (match) {
                const attr = match[1];
                const attrKey = match[2];
                element.setAttribute(attr, i18next.t(attrKey));
            }
        } else {
            // 通常のテキストコンテンツの処理
            element.textContent = i18next.t(key);
        }
    });
}

// 言語が変更された時の処理
i18next.on('languageChanged', () => {
    updateContent();
});

// 動的テキスト翻訳の例
function updateDynamicText(key, options) {
    return i18next.t(key, options);
}