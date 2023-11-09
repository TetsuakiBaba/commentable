const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: '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' });

async function askAssistant(question) {
    try {
        const response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo", // または利用可能な最新のモデルを指定
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant.",
                },
                {
                    role: "user",
                    content: question,
                },
            ],
        });

        console.log(response.data.choices[0].message.content);
    } catch (error) {
        console.error(error);
    }
}

// 例として質問をしてみます
askAssistant("What is the capital of France?");
