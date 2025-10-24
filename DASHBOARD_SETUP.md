# ダッシュボード設定ガイド

## ローカル環境でのセットアップ

1. サンプル設定ファイルをコピー:
```bash
cp dashboard-config.sample.js dashboard-config.js
```

2. `dashboard-config.js` を編集してパスワードを設定:
```javascript
module.exports = {
    adminPassword: 'your-secure-password-here'
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
    adminPassword: 'あなたの安全なパスワード'
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
