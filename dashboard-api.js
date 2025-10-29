const fs = require('fs');
const path = require('path');
const express = require('express');

// ダッシュボード用APIルーター
const router = express.Router();

// チャットログディレクトリのパス
const LOG_DIR = path.join(__dirname, 'public', 'chatlogs');

// 管理者パスワードの取得
// 優先順位: 1. 環境変数 2. dashboard-config.js 3. デフォルト値
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let SKIP_AUTH = false;

if (!ADMIN_PASSWORD) {
    try {
        const config = require('./dashboard-config');
        ADMIN_PASSWORD = config.adminPassword;
        SKIP_AUTH = config.skipAuth || false;
        console.log('Admin password loaded from dashboard-config.js');
        if (SKIP_AUTH) {
            console.warn('⚠️  WARNING: Authentication is DISABLED (skipAuth: true)');
            console.warn('⚠️  This should ONLY be used for development/debugging!');
        }
    } catch (error) {
        // dashboard-config.jsが存在しない場合はデフォルト値
        ADMIN_PASSWORD = 'admin123';
        console.warn('Warning: Using default admin password. Please set ADMIN_PASSWORD environment variable or create dashboard-config.js');
    }
}

// 簡易的な認証チェック用ミドルウェア
function checkAuth(req, res, next) {
    // skipAuthが有効な場合は認証をスキップ
    if (SKIP_AUTH) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const password = authHeader.replace('Bearer ', '');
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    next();
}

// パスワード認証エンドポイント
router.post('/api/dashboard/auth', (req, res) => {
    // skipAuthが有効な場合は常に成功を返す
    if (SKIP_AUTH) {
        return res.json({ success: true, message: 'Authentication skipped (development mode)' });
    }

    const { password } = req.body;

    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, message: 'Authentication successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// 認証状態確認エンドポイント（skipAuth設定を取得）
router.get('/api/dashboard/auth/status', (req, res) => {
    console.log('📍 /api/dashboard/auth/status called, SKIP_AUTH:', SKIP_AUTH);
    res.json({
        skipAuth: SKIP_AUTH
    });
});

// ログファイル一覧取得
router.get('/api/dashboard/logs', checkAuth, async (req, res) => {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            return res.json({ logs: [] });
        }

        const files = fs.readdirSync(LOG_DIR);
        const logFiles = files.filter(file => path.extname(file) === '.log');

        const logsData = await Promise.all(
            logFiles.map(async (file) => {
                try {
                    const filePath = path.join(LOG_DIR, file);
                    const stats = fs.statSync(filePath);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const lines = content.trim().split('\n').filter(line => line.trim());

                    // ユニークユーザー数を計算
                    const users = new Set();
                    let lastTimestamp = null;

                    lines.forEach(line => {
                        try {
                            const data = JSON.parse(line);
                            if (data.username) {
                                users.add(data.username);
                            }
                            if (data.timestamp) {
                                lastTimestamp = data.timestamp;
                            }
                        } catch (e) {
                            // 無効な行はスキップ
                        }
                    });

                    return {
                        name: file,
                        size: stats.size,
                        commentCount: lines.length,
                        uniqueUsers: users.size,
                        lastModified: stats.mtime,
                        lastCommentTimestamp: lastTimestamp
                    };
                } catch (error) {
                    console.error(`Error processing log file ${file}:`, error);
                    return null;
                }
            })
        );

        // nullを除外してソート（最終更新日時の降順）
        const validLogs = logsData
            .filter(log => log !== null)
            .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

        res.json({ logs: validLogs });
    } catch (error) {
        console.error('Error getting log list:', error);
        res.status(500).json({ error: 'Failed to get log list' });
    }
});

// 特定のログファイルの詳細取得
router.get('/api/dashboard/logs/:filename', checkAuth, (req, res) => {
    try {
        const filename = req.params.filename;

        // セキュリティ: ファイル名のバリデーション
        if (!filename.endsWith('.log') || filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(LOG_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }

        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        const comments = [];
        const users = new Set();

        lines.forEach(line => {
            try {
                const data = JSON.parse(line);
                comments.push(data);
                if (data.username) {
                    users.add(data.username);
                }
            } catch (e) {
                // 無効な行はスキップ
            }
        });

        res.json({
            name: filename,
            size: stats.size,
            lastModified: stats.mtime,
            commentCount: comments.length,
            uniqueUsers: users.size,
            comments: comments
        });
    } catch (error) {
        console.error('Error getting log detail:', error);
        res.status(500).json({ error: 'Failed to get log detail' });
    }
});

// ログファイルの削除
router.delete('/api/dashboard/logs/:filename', checkAuth, (req, res) => {
    try {
        const filename = req.params.filename;

        // セキュリティ: ファイル名のバリデーション
        if (!filename.endsWith('.log') || filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(LOG_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }

        fs.unlinkSync(filePath);
        console.log(`Log file deleted by admin: ${filename}`);

        res.json({ success: true, message: `Log file ${filename} deleted successfully` });
    } catch (error) {
        console.error('Error deleting log file:', error);
        res.status(500).json({ error: 'Failed to delete log file' });
    }
});

// 統計情報取得
router.get('/api/dashboard/stats', checkAuth, (req, res) => {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            return res.json({
                totalLogs: 0,
                totalComments: 0,
                totalSize: 0,
                totalUsers: 0
            });
        }

        const files = fs.readdirSync(LOG_DIR);
        const logFiles = files.filter(file => path.extname(file) === '.log');

        let totalComments = 0;
        let totalSize = 0;
        const allUsers = new Set();

        logFiles.forEach(file => {
            try {
                const filePath = path.join(LOG_DIR, file);
                const stats = fs.statSync(filePath);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line.trim());

                totalSize += stats.size;
                totalComments += lines.length;

                lines.forEach(line => {
                    try {
                        const data = JSON.parse(line);
                        if (data.username) {
                            allUsers.add(data.username);
                        }
                    } catch (e) {
                        // 無効な行はスキップ
                    }
                });
            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        });

        res.json({
            totalLogs: logFiles.length,
            totalComments: totalComments,
            totalSize: totalSize,
            totalUsers: allUsers.size
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// 統計情報をCSVでエクスポート
router.get('/api/dashboard/export/stats', checkAuth, (req, res) => {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            return res.status(404).json({ error: 'No logs found' });
        }

        const files = fs.readdirSync(LOG_DIR);
        const logFiles = files.filter(file => path.extname(file) === '.log');

        const csvRows = [];
        csvRows.push('ファイル名,コメント数,ユニークユーザー数,ファイルサイズ(bytes),最終更新日時');

        logFiles.forEach(file => {
            try {
                const filePath = path.join(LOG_DIR, file);
                const stats = fs.statSync(filePath);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line.trim());

                const users = new Set();
                lines.forEach(line => {
                    try {
                        const data = JSON.parse(line);
                        if (data.username) {
                            users.add(data.username);
                        }
                    } catch (e) {
                        // 無効な行はスキップ
                    }
                });

                csvRows.push(
                    `"${file}",${lines.length},${users.size},${stats.size},"${stats.mtime.toISOString()}"`
                );
            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        });

        const csvContent = csvRows.join('\n');

        // UTF-8 BOMを追加
        const bom = '\uFEFF';

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="chatlog_stats.csv"');
        res.send(bom + csvContent);
    } catch (error) {
        console.error('Error exporting stats:', error);
        res.status(500).json({ error: 'Failed to export statistics' });
    }
});

// 古いログの手動クリーンアップ実行
router.post('/api/dashboard/cleanup', checkAuth, (req, res) => {
    try {
        const { retentionDays } = req.body;
        const retention = retentionDays || 21;

        if (!fs.existsSync(LOG_DIR)) {
            return res.json({ deletedCount: 0, message: 'No logs directory found' });
        }

        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const retentionPeriodMs = retention * 24 * 60 * 60 * 1000;
        let deletedCount = 0;
        const deletedFiles = [];

        files.forEach(file => {
            if (path.extname(file) !== '.log') {
                return;
            }

            try {
                const filePath = path.join(LOG_DIR, file);
                const stats = fs.statSync(filePath);
                const lastModified = stats.mtime.getTime();
                const ageInMs = now - lastModified;

                if (ageInMs > retentionPeriodMs) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    deletedFiles.push(file);
                    console.log(`Deleted old log file: ${file}`);
                }
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
            }
        });

        res.json({
            success: true,
            deletedCount: deletedCount,
            deletedFiles: deletedFiles,
            message: `${deletedCount} old log file(s) deleted`
        });
    } catch (error) {
        console.error('Error during cleanup:', error);
        res.status(500).json({ error: 'Failed to cleanup logs' });
    }
});

// システム設定情報取得
router.get('/api/dashboard/system-info', checkAuth, (req, res) => {
    try {
        // server.jsから設定を読み取る（環境変数経由が望ましい）
        const retentionDays = process.env.LOG_RETENTION_DAYS || 21;
        const checkIntervalHours = process.env.CLEANUP_CHECK_INTERVAL_HOURS || 24;

        res.json({
            retentionDays: retentionDays,
            checkIntervalHours: checkIntervalHours,
            logDirectory: LOG_DIR
        });
    } catch (error) {
        console.error('Error getting system info:', error);
        res.status(500).json({ error: 'Failed to get system info' });
    }
});

module.exports = router;
