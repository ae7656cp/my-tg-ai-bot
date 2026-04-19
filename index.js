require('dotenv').config({ path: './config.env' });
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const groq = new Groq({ apiKey: process.env.GEMINI_KEY });

// Память чата (храним последние 15 реплик)
let chatMemory = [];

async function getAIResponse(text, base64Image = null) {
    try {
        console.log(`[AI-LOG] Анализ. Фото: ${base64Image ? '✅ ЕСТЬ' : '❌ НЕТ'}`);
        
        let messages = [
            { role: "system", content: "Ты опытный QA-инженер. Ты видишь всю переписку и анализируешь скриншоты." },
            ...chatMemory
        ];

        if (base64Image) {
            messages.push({
                role: "user",
                content: [
                    { type: "text", text: text || "Что на этом изображении?" },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ]
            });
        } else {
            messages.push({ role: "user", content: text });
        }

        const completion = await groq.chat.completions.create({
            messages: messages,
            // Используем стабильную модель для зрения
            model: base64Image ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile",
        });

        const aiAnswer = completion.choices[0]?.message?.content;
        
        // Запоминаем ответ бота
        chatMemory.push({ role: "assistant", content: aiAnswer });
        if (chatMemory.length > 15) chatMemory.shift();

        return aiAnswer;
    } catch (error) {
        console.error("Ошибка Groq:", error.message);
        return "Ошибка нейросети. Возможно, модель Vision сейчас недоступна в Groq.";
    }
}

bot.on(['text', 'photo'], async (ctx) => {
    const messageText = ctx.message.text || ctx.message.caption || "";
    let base64Image = null;

    // Проверяем, есть ли в сообщении фото
    if (ctx.message.photo) {
        console.log('📸 Фото получено, начинаю загрузку...');
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const link = await ctx.telegram.getFileLink(fileId);
            const response = await axios.get(link.href, { responseType: 'arraybuffer' });
            base64Image = Buffer.from(response.data, 'binary').toString('base64');
            console.log('✅ Фото успешно скачано и готово');
        } catch (e) {
            console.error('❌ Ошибка при работе с фото:', e.message);
        }
    }

    // ЛОГИКА ОТВЕТА:
    if (messageText.toLowerCase().includes('бот')) {
        // Если позвали бота — отвечаем
        await ctx.sendChatAction('typing');
        const cleanText = messageText.replace(/бот/i, "").trim();
        const response = await getAIResponse(cleanText, base64Image);
        await ctx.reply(response);
    } else {
        // Если пишут без команды — просто молча запоминаем в память
        const memoryContent = base64Image ? `[Пользователь прислал фото] ${messageText}` : messageText;
        chatMemory.push({ role: "user", content: memoryContent });
        console.log('🧠 Запомнил контекст (без ответа)');
        
        if (chatMemory.length > 15) chatMemory.shift();
    }
});

bot.launch().then(() => console.log('🚀 БОТ ЗАПУЩЕН! Теперь он помнит всё и умеет смотреть.'));