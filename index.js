const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAEOG-FMm-SXlmAm0ie8cbR5gxM7n18_RXA";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DATABASE =====
let db = { users: [], approved: [], tokens: {} };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

// ===== MEMORY =====
let sessions = {};

// ===== START =====
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (!db.users.includes(chatId)) {
        db.users.push(chatId);
        saveDB();
    }

    if (!db.approved.includes(chatId)) {
        bot.sendMessage(OWNER_ID, `📩 Request: ${chatId}`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Approve", callback_data: "approve_" + chatId },
                    { text: "❌ Reject", callback_data: "reject_" + chatId }
                ]]
            }
        });

        return bot.sendMessage(chatId, "⏳ Waiting for approval...");
    }

    menu(chatId);
});

// ===== MENU =====
function menu(chatId) {
    bot.sendMessage(chatId, "🚀 *GitHub Manager + AI*", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login", callback_data: "login" }],
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "🤖 HELP TO AI", callback_data: "ai_chat" }],
                [{ text: "📊 Stats", callback_data: "stats" }],
                [{ text: "📢 Help", callback_data: "help" }]
            ]
        }
    });
}

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    bot.sendMessage(msg.chat.id,
        `👥 Users: ${db.users.length}\n✅ Approved: ${db.approved.length}`
    );
});

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;
    if (!db.approved.includes(chatId)) return;

    // AUTO LOGIN
    if (!sessions[chatId] && db.tokens[chatId]) {
        sessions[chatId] = db.tokens[chatId];
    }

    let s = sessions[chatId] || {};

    // ===== AI CHAT MODE =====
    if (s.aiMode) {
        try {
            const ai = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: msg.text }]
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_KEY}`
                    }
                }
            );

            return bot.sendMessage(chatId, ai.data.choices[0].message.content);
        } catch {
            return bot.sendMessage(chatId, "❌ AI error");
        }
    }

    // LOGIN
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${msg.text}`,
                    "User-Agent": "bot"
                }
            });

            sessions[chatId] = {
                token: msg.text,
                username: user.data.login
            };

            db.tokens[chatId] = sessions[chatId];
            saveDB();

            return bot.sendMessage(chatId, "✅ Logged in");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // CREATE REPO NAME
    if (s.createStep === "name") {
        s.repoName = msg.text;
        s.createStep = "visibility";

        return bot.sendMessage(chatId, "🔒 Select:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌐 Public", callback_data: "repo_public" }],
                    [{ text: "🔐 Private", callback_data: "repo_private" }]
                ]
            }
        });
    }
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // APPROVE
    if (data.startsWith("approve_")) {
        const id = parseInt(data.split("_")[1]);
        if (!db.approved.includes(id)) {
            db.approved.push(id);
            saveDB();
        }
        bot.sendMessage(id, "✅ Approved");
        return;
    }

    // AUTO LOGIN
    if (!sessions[chatId] && db.tokens[chatId]) {
        sessions[chatId] = db.tokens[chatId];
    }

    let s = sessions[chatId];

    if (!s?.token && data !== "ai_chat") {
        return bot.sendMessage(chatId, "🔑 Login first");
    }

    // ===== AI CHAT BUTTON =====
    if (data === "ai_chat") {
        sessions[chatId] = sessions[chatId] || {};
        sessions[chatId].aiMode = true;

        return bot.sendMessage(chatId,
            "🤖 AI Chat ON\nSend anything...\n\n(Exit: /start)"
        );
    }

    // HELP
    if (data === "help") {
        return bot.sendMessage(chatId,
`📖 HOW TO USE

Login → send GitHub token  
Repos → select repo  
File → manage  

🤖 AI Chat → ask anything  

Admin:
/stats`);
    }

    // STATS BUTTON
    if (data === "stats") {
        if (chatId !== OWNER_ID) return;
        return bot.sendMessage(chatId,
            `👥 Users: ${db.users.length}\n✅ Approved: ${db.approved.length}`
        );
    }

    // CREATE REPO
    if (data === "create_repo") {
        s.createStep = "name";
        return bot.sendMessage(chatId, "📦 Send repo name:");
    }

    if (data === "repo_public" || data === "repo_private") {
        try {
            await axios.post(
                "https://api.github.com/user/repos",
                {
                    name: s.repoName,
                    private: data === "repo_private"
                },
                {
                    headers: {
                        Authorization: `Bearer ${s.token}`,
                        "User-Agent": "bot",
                        Accept: "application/vnd.github+json"
                    }
                }
            );

            bot.sendMessage(chatId, `✅ Repo Created: ${s.repoName}`);
        } catch (e) {
            bot.sendMessage(chatId, "❌ Create failed");
        }

        s.createStep = null;
    }

    // REPOS
    if (data === "repos") {
        const res = await axios.get("https://api.github.com/user/repos", {
            headers: {
                Authorization: `Bearer ${s.token}`,
                "User-Agent": "bot"
            }
        });

        let buttons = res.data.map(r => ([{
            text: r.name,
            callback_data: "repo_" + r.name
        }]));

        return bot.sendMessage(chatId, "📂 Repos:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    bot.answerCallbackQuery(q.id);
});
