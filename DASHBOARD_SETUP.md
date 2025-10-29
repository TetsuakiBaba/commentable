# ダッシュボード設定ガイド

## ローカル環境でのセットアップ

1. サンプル設定ファイルをコピー:
```bash
cp dashboard-config.sample.js dashboard-config.js
```

2. `dashboard-config.js` を編集してパスワードを設定:
```javascript
module.exports = {
    adminPassword: 'your-secure-password-here',
    
    // 開発・デバッグモード（オプション）
    // true にすると認証なしでダッシュボードにアクセスできます
    // 本番環境では必ず false にするか、この行を削除してください
    skipAuth: false  // デフォルト: false
};
```

**開発環境で認証をスキップする場合:**
```javascript
module.exports = {
    adminPassword: 'your-secure-password-here',
    skipAuth: true  // 開発時のみ true に設定
};
```

3. サーバーを起動:
```bash
node server.js
```

4. ダッシュボードにアクセス:
```
http://localhost:3000/dashboard/
```

## Render (本番環境) でのセットアップ

### 方法1: 環境変数を使用 (推奨)

1. Renderのダッシュボードで Environment Variables を設定:
   - Key: `ADMIN_PASSWORD`
   - Value: `あなたの安全なパスワード`

2. デプロイ完了後、そのまま使用可能

### 方法2: シェルから設定ファイルを作成

1. Renderのダッシュボードで Shell を開く

2. 以下のコマンドを実行:
```bash
cat > dashboard-config.js << 'EOF'
module.exports = {
    adminPassword: 'あなたの安全なパスワード',
    skipAuth: false  // 本番環境では必ず false
};
EOF
```

3. サービスを再起動

## パスワード読み込みの優先順位

1. **環境変数** `ADMIN_PASSWORD` (最優先)
2. **設定ファイル** `dashboard-config.js`
3. **デフォルト値** `admin123` (開発用のみ)

## セキュリティに関する注意

- `dashboard-config.js` は `.gitignore` に含まれているため、Git にコミットされません
- 本番環境では必ず強力なパスワードを設定してください
- 環境変数での管理を推奨します
- デフォルトパスワード (`admin123`) は開発環境でのみ使用してください
- **`skipAuth: true` は開発・デバッグ時のみ使用してください**
  - 本番環境では必ず `false` にするか、設定を削除してください
  - `skipAuth: true` の場合、認証なしでダッシュボードにアクセスできます
  - サーバー起動時に警告メッセージが表示されます

## skipAuth オプションについて

### 用途
開発やデバッグ時に、毎回パスワードを入力する手間を省くためのオプションです。

### 設定方法
```javascript
module.exports = {
    adminPassword: 'your-password',
    skipAuth: true  // 認証をスキップ
};
```

### 動作
- `skipAuth: true` の場合:
  - ダッシュボードを開くと、ログイン画面をスキップして直接ダッシュボードが表示されます
  - サーバー起動時に警告メッセージが表示されます
  - すべてのAPI認証チェックがスキップされます

- `skipAuth: false` または未設定の場合:
  - 通常通りログイン画面が表示されます
  - パスワード認証が必要です

### 注意事項
- **本番環境では絶対に `skipAuth: true` にしないでください**
- 設定を省略した場合、デフォルトで `false` になります
- 開発が終わったら必ず `false` に戻すか、この設定を削除してください

## トラブルシューティング

### パスワードが反映されない場合

1. サーバーのログを確認:
   - `Admin password loaded from dashboard-config.js` が表示されれば設定ファイルから読み込まれています
   - `Warning: Using default admin password` が表示される場合は設定が読み込まれていません

2. 設定ファイルのパスを確認:
   - `dashboard-config.js` はプロジェクトのルートディレクトリに配置してください

3. ファイルの構文を確認:
   - JavaScript の構文エラーがないか確認してください

4. サーバーを再起動してください
