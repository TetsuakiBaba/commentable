#!/usr/bin/env node
// ローカルでの動作確認用に、偽の参加者をつないでコメントとリアクションを流す。
// 本番のサーバーには使わない（--server に本番の URL を指定すると止める）
//
// 使い方:
//   node tools/fake-comments.js [--server http://localhost:3000] [--room test]
//        [--users 3] [--interval 3] [--reaction-rate 0.3] [--ai-rate 0]
//   --interval      1 人あたりの投稿の平均間隔（秒）
//   --reaction-rate 投稿のうちリアクション（絵文字）にする割合（0〜1）
//   --ai-rate       コメントのうち AI アシスタントの名前で呼びかける割合（0〜1、--ai-name で名前を変える）
//   Ctrl+C で止める

const crypto = require('crypto');
const { io } = require('socket.io-client');

const PRODUCTION_SERVER = 'https://commentable.onrender.com';

const COMMENTS = [
    'こんにちは', 'なるほど', 'わかりやすいです', 'もう一度お願いします', 'ちょっと速いです',
    'スライドが見えません', '面白い！', '質問があります', 'ここテストに出ますか？', '音声聞こえてます',
    'ありがとうございます', 'その例もう少し詳しく', '同じ意見です', '少し難しい…', '草',
];
const AI_QUESTIONS = ['今日のテーマは何？', 'おすすめの本ある？', '元気？', 'この話を一言でまとめて'];
const REACTIONS = ['👍', '🙏', '🙋', '🥺', '🤫'];
const NAMES = ['テスト太郎', 'テスト花子', 'テスト次郎', 'テスト三郎', 'テスト四郎', 'テスト五郎', '', ''];

function parseArgs(argv) {
    const options = {
        server: 'http://localhost:3000', room: 'test', users: 3, interval: 3,
        reactionRate: 0.3, aiRate: 0, aiName: '米太郎',
    };
    const names = {
        '--server': 'server', '--room': 'room', '--users': 'users', '--interval': 'interval',
        '--reaction-rate': 'reactionRate', '--ai-rate': 'aiRate', '--ai-name': 'aiName',
    };
    for (let i = 0; i < argv.length; i++) {
        const key = names[argv[i]];
        if (!key || i + 1 >= argv.length) {
            console.error(`不明なオプション: ${argv[i]}`);
            process.exit(1);
        }
        const value = argv[++i];
        options[key] = typeof options[key] === 'number' ? Number(value) : value;
    }
    options.server = options.server.replace(/\/$/, '');
    return options;
}

const pick = list => list[Math.floor(Math.random() * list.length)];

// 平均 seconds 秒の、ばらつきのある待ち時間（0.5〜1.5 倍）
const jitter = seconds => seconds * 1000 * (0.5 + Math.random());

function startParticipant(options, index) {
    const name = NAMES[index % NAMES.length];
    const socket = io(options.server, { transports: ['websocket'] });
    let timer = null;

    const post = () => {
        const reaction = Math.random() < options.reactionRate;
        const comment = reaction ? pick(REACTIONS)
            : Math.random() < options.aiRate ? `${options.aiName}、${pick(AI_QUESTIONS)}`
                : pick(COMMENTS);
        // 投稿ページ（public/comment_app.js の buildData）と同じ形
        socket.emit('comment', {
            my_name: name,
            comment,
            flg_speech: false,
            color_text: '#ffffff',
            color_text_stroke: '#000000',
            text_direction: 'left',
            font_size: 'medium',
            flg_emoji: reaction,
            flg_sound: false,
            id_sound: 0,
            hidden: -1,
        });
        console.log(`[${name || '名無し'}] ${comment}`);
        timer = setTimeout(post, jitter(options.interval));
    };

    socket.on('connect', () => {
        socket.emit('join', options.room, { role: 'participant', participantId: crypto.randomUUID(), name });
        clearTimeout(timer);
        timer = setTimeout(post, jitter(options.interval));
    });
    socket.on('disconnect', () => clearTimeout(timer));
    socket.on('connect_error', error => console.error(`接続できません（${options.server}）: ${error.message}`));
    return socket;
}

const options = parseArgs(process.argv.slice(2));
if (options.server === PRODUCTION_SERVER) {
    console.error('本番のサーバーには偽のコメントを流せません');
    process.exit(1);
}
console.log(`${options.server} の部屋「${options.room}」に ${options.users} 人でコメントを流します（Ctrl+C で止める）`);
const sockets = Array.from({ length: options.users }, (_, i) => startParticipant(options, i));
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        sockets.forEach(socket => socket.close());
        process.exit(0);
    });
}
