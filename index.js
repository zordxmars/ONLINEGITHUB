const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// ===== CONFIG =====
const TOKEN = "8686861247:AAHW0kTvgw8we8Aq2Fi6i-z6lLUvwA4pW3Y";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("✅ Bot Started");

// ===== ERROR PROTECTION =====
process.on("uncaughtException", err => console.log("ERROR:", err));
process.on("unhandledRejection", err => console.log("REJECTION:", err));

// ===== DATABASE =====
let db = { users: [] };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

// ===== SESSION =====
let sessions = {};
const getSession = (id) => {
    if (!sessions[id]) sessions[id] = {};
    return sessions[id];
};

// ===== START =====
bot.onText(/\/start/, (msg) => {
    const id = msg.chat.id;

    if (!db.users.includes(id)) {
        db.users.push(id);
        saveDB();
        bot.sendMessage(OWNER_ID, `👤 New User: ${id}`);
    }

    menu(id);
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 GitHub Manager PRO", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "🔍 Search Repo", callback_data: "search_repo" }],
                [{ text: "🤖 AI Fix", callback_data: "ai" }]
            ]
        }
    });
}

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    bot.sendMessage(msg.chat.id, `👥 Users: ${db.users.length}`);
});

// ===== BROADCAST =====
bot.onText(/\/broadcast (.+)/, (msg, m) => {
    if (msg.chat.id !== OWNER_ID) return;

    db.users.forEach(id => {
        bot.sendMessage(id, m[1]).catch(() => {});
    });

    bot.sendMessage(msg.chat.id, "✅ Broadcast done");
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;

    const s = getSession(id);

    try {

        // ===== LOGIN CHECK =====
        if (!s.token && data !== "login") {
            return bot.sendMessage(id, "🔑 Send GitHub token first");
        }

        // ===== REPOS =====
        if (data === "repos") {
            const res = await axios.get("https://api.github.com/user/repos", {
                headers: { Authorization: `Bearer ${s.token}` }
            });

            let btn = res.data.map(r => ([{
                text: r.name,
                callback_data: "repo_" + encodeURIComponent(r.name)
            }]));

            return bot.sendMessage(id, "📂 Repos:", {
                reply_markup: { inline_keyboard: btn }
            });
        }

        // ===== CREATE =====
        if (data === "create_repo") {
            s.create = true;
            return bot.sendMessage(id, "Send repo name");
        }

        // ===== SEARCH =====
        if (data === "search_repo") {
            s.search = true;
            return bot.sendMessage(id, "Send repo name");
        }

        // ===== AI =====
        if (data === "ai") {
            s.ai = true;
            return bot.sendMessage(id, "Send code to fix");
        }

        // ===== SELECT REPO =====
        if (data.startsWith("repo_")) {
            s.repo = decodeURIComponent(data.split("_")[1]);

            const res = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            let files = res.data.map(f => ([{
                text: f.name,
                callback_data: "file_" + encodeURIComponent(f.path)
            }]));

            files.push([{ text: "📦 ZIP", callback_data: "zip" }]);

            return bot.sendMessage(id, "📂 Files:", {
                reply_markup: { inline_keyboard: files }
            });
        }

        // ===== ZIP =====
        if (data === "zip") {
            return bot.sendMessage(id,
                `https://github.com/${s.username}/${s.repo}/archive/refs/heads/main.zip`
            );
        }

        // ===== FILE =====
        if (data.startsWith("file_")) {
            s.file = decodeURIComponent(data.split("_")[1]);

            const res = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            const content = Buffer.from(res.data.content, "base64").toString();

            bot.sendMessage(id, content.slice(0, 1500));

            return bot.sendMessage(id, "⚙️", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✏️ Edit", callback_data: "edit" }],
                        [{ text: "🗑 Delete", callback_data: "delete" }]
                    ]
                }
            });
        }

    } catch (err) {
        console.log(err);
        bot.sendMessage(id, "❌ Error, try again");
    }

    bot.answerCallbackQuery(q.id);
});

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    const id = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    const s = getSession(id);

    try {

        // ===== LOGIN =====
        if (!s.token) {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${text}` }
            });

            s.token = text;
            s.username = user.data.login;

            return bot.sendMessage(id, "✅ Logged in");
        }

        // ===== CREATE =====
        if (s.create) {
            await axios.post(
                "https://api.github.com/user/repos",
                { name: text },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            bot.sendMessage(id, "✅ Repo created");
            s.create = false;
            return;
        }

        // ===== SEARCH =====
        if (s.search) {
            const res = await axios.get(
                `https://api.github.com/search/repositories?q=${text}`
            );

            let result = res.data.items.slice(0, 5)
                .map(r => r.full_name).join("\n");

            bot.sendMessage(id, result);
            s.search = false;
            return;
        }

        // ===== AI =====
        if (s.ai) {
            const res = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{
                        role: "user",
                        content: `Fix this code:\n${text}`
                    }]
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_KEY}`
                    }
                }
            );

            bot.sendMessage(id, res.data.choices[0].message.content);
            s.ai = false;
            return;
        }

    } catch (err) {
        console.log(err);
        bot.sendMessage(id, "❌ Error occurred");
    }
});
