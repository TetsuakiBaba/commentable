// import OpenAI from "openai";
// import WebSocket from 'ws';

const OpenAI = require("openai");
const io = require('socket.io-client');

let conversationId; // 会話のIDを保持する変数

const openai = new OpenAI({
    apiKey: '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',
    dangerouslyAllowBrowser: true // ***注意*** クライアントサイドの実行を許可
});

let thread;
let assistant;

async function startGPT() {
    try {
        // assistant = await openai.beta.assistants.create({
        //     model: "gpt-3.5-turbo",
        //     name: "さくら",
        //     instructions: "あなたは授業を補助するTAです。名前はさくらです。先生は画面を共有しており、コメントテキストが先生の画面にリアルタイムに表示されるCommentableというシステムを利用しています。与えられたテキストに対して同調したり、反論したり、ときには自分の考えを示したりすることで、授業を盛り上げてください。なるべく短い返答が好まれます。",
        //     // max_tokens: 80,
        // });
        assistant = await openai.beta.assistants.retrieve(
            "asst_IxcsPWgJ9fTdDwcf6RvG3Kzm"
        );
        //thread = await openai.beta.threads.create();
        // thread_J0GB9aGP96v9XjDUenQUiO1z
        thread = await openai.beta.threads.retrieve(
            "thread_J0GB9aGP96v9XjDUenQUiO1z"
        );


    } catch (error) {
        console.error(error);
    }
}

async function askGPT(text) {
    try {

        // メッセージを追加
        let message = await openai.beta.threads.messages.create(
            thread.id,
            {
                role: "user",
                content: text
            }
        );

        console.log(message.content.length);
        message = await openai.beta.threads.runs.create(
            thread.id,
            {
                assistant_id: assistant.id,
            }
        );

        let run;
        let int_id = setInterval(async function () {
            run = await openai.beta.threads.runs.retrieve(
                thread.id,
                message.id
            );
            if (run.status == 'completed') {
                const msg = await openai.beta.threads.messages.list(
                    thread.id
                );

                clearInterval(int_id)
                console.log("result:", msg.body.data[0].content[0].text.value);
                answer(msg.body.data[0].content[0].text.value);
            }
            else if (run.status == 'failed' || run.status == 'cancelled') {
                clearInterval(int_id);
                console.error('GPTからの回答エラー');
            }
            else {
                console.log("waiting...", run.status)
            }
        }, 1000);
    }
    catch (error) {
        console.error(error);
    }
}
// main();

function answer(text) {

    let data = {
        room_name: room,
        my_name: 'TA米太郎',
        comment: text,
        flg_speech: false,
        color_text: '#FFFF00',
        color_text_stroke: '#000000',
        flg_image: false,
        id_image: 0,
        flg_sound: false,
        id_sound: false,
        text_direction: 'left',
        hidden: -1
    }

    socket.emit("comment", data);
}


const room = 'id2023';
// 接続先URL
const url = 'https://bbcommentable.herokuapp.com/';
//const url = 'http://localhost:80';

// ソケットオブジェクトを生成
const socket = io(url);


// 接続が確立したときのイベント
socket.on('connect', () => {
    console.log('Successfully connected to the server.');
});


// 接続がオープンになったときのイベント
//socket.emit('connection');

console.log(url);
// 接続がオープンになったときのイベント
socket.on('you_are_connected', function () {
    console.log('Connected');
    socket.emit('join', room);
});

socket.on('reconnect', () => {
    console.log('you have been reconnected');
    socket.emit('join', room);
});

// メッセージを受信したときのイベント
socket.on('message', (message) => {
    console.log(`Received: ${message}`);
});

// エラーが発生したときのイベント
socket.on('error', (err) => {
    console.log(`Error: ${err}`);
});

// 接続がクローズしたときのイベント
socket.on('disconnect', () => {
    console.log('Disconnected');
});

socket.on('comment', newComment);

let timer = null;

function newComment(data) {
    console.log(data);
    if (!timer) {
        // 処理
        if ((data.comment.includes('米太郎') || data.comment.includes('こめたろう')) || data.comment.includes('TA') && !timer) {
            askGPT(data.comment);
            timer = setTimeout(() => {
                clearTimeout(timer);
                timer = null;
            }, 1000);
        }
    }
    else {

    }
}

startGPT();
