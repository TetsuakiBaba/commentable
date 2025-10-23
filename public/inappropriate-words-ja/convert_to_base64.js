const fs = require('fs');

const files = [
    'Sexual.txt',
    'Sexual_with_mask.txt',
    'Sexual_with_bopo.txt'
];

files.forEach(filePath => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const base64Lines = lines.map(line => Buffer.from(line, 'utf-8').toString('base64'));
        const outputPath = filePath.replace('.txt', '.base64.txt');
        fs.writeFileSync(outputPath, base64Lines.join('\n'), 'utf-8');
        console.log(`✓ ${filePath} -> ${outputPath} (${lines.length}行を変換)`);
    } catch (error) {
        console.error(`✗ ${filePath} の変換に失敗:`, error.message);
    }
});

console.log('\nbase64変換が完了しました。');
