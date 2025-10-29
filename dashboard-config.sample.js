// ダッシュボード管理者パスワード設定 (サンプル)
// このファイルをコピーして dashboard-config.js を作成してください
// dashboard-config.js は .gitignore に含まれているため、Gitにコミットされません

module.exports = {
    // 管理者パスワード
    // 本番環境では強力なパスワードに変更してください
    adminPassword: 'your-secure-password-here',

    // 開発・デバッグモード（認証スキップ）
    // true にすると認証なしでダッシュボードにアクセスできます
    // 本番環境では必ず false にしてください
    skipAuth: false
};
