// macOS でのみネイティブアドオンをビルドする（他OSでは何もしない）
// N-API を使っているので Electron 用ではなくシステムの Node ヘッダでビルドして問題ない
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
    console.log('[person-segmentation] skip build (macOS only)');
    process.exit(0);
}

const binary = path.join(__dirname, 'build/Release/person_segmentation.node');
if (process.argv.includes('--if-missing') && fs.existsSync(binary)) {
    process.exit(0);
}

const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
execFileSync(process.execPath, [nodeGyp, 'rebuild'], {
    cwd: __dirname,
    stdio: 'inherit'
});
console.log('[person-segmentation] built:', binary);
