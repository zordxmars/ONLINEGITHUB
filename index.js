const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// ===== DEBUG =====
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

// ===== CONFIG =====
const TOKEN = process.env.TOKEN || "8686861247:AAGhRo-Zglg7uNznNoAweKKPtBbkGF4Jegs";
const OWNER_ID = parseInt(process.env.OWNER_ID || "8721643962");

if (!TOKEN) {
    console.log("❌ TOKEN missing");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Bot Started");

// ===== DATABASE =====
let db = { users: [], approved: [], tokens: {} };

try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}

const saveDB = () => {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
};

// ===== SESSION =====
let sessions = {};

// ===== START =====
bot.onText(/\/start/, (msg) => {
    const id = msg.chat.id;

    if (!db.users.includes(id)) {
        db.users.push(id);
        saveDB();
    }

    // auto approve owner
    if (id === OWNER_ID && !db.approved.includes(id)) {
        db.approved.push(id);
        saveDB();
    }

    if (!db.approved.includes(id)) {
        return bot.sendMessage(id, "⛔ Access Denied (Ask Admin)");
    }

    bot.sendMessage(id, "🚀 Bot Ready", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login", callback_data: "login" }],
                [{ text: "📁 My Repos", callback_data: "repos" }]
            ]
        }
    });
});

// ===== LOGIN =====
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const id = msg.chat.id;
    if (!db.approved.includes(id)) return;

    let s = sessions[id] || {};

    // restore session
    if (!sessions[id] && db.tokens[id]) {
        sessions[id] = db.tokens[id];
        s = sessions[id];
    }

    // login
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${msg.text}` }
            });

            sessions[id] = {
                token: msg.text,
                username: user.data.login
            };

            db.tokens[id] = sessions[id];
            saveDB();

            return bot.sendMessage(id, "✅ Login Success");
        } catch {
            return bot.sendMessage(id, "❌ Invalid Token");
        }
    }
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;

    let s = sessions[id];

    if (!s && db.tokens[id]) {
        sessions[id] = db.tokens[id];
        s = sessions[id];
    }

    if (!s?.token && data !== "login") {
        return bot.sendMessage(id, "🔑 Login first");
    }

    // ===== LOGIN BUTTON =====
    if (data === "login") {
        return bot.sendMessage(id, "Send your GitHub Token");
    }

    // ===== REPOS =====
    if (data === "repos") {
        try {
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
        } catch (e) {
            return bot.sendMessage(id, "❌ Repo fetch error");
        }
    }

    // ===== SELECT REPO =====
    if (data.startsWith("repo_")) {
        s.repo = decodeURIComponent(data.replace("repo_", ""));

        try {
            const res = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            let files = res.data.map(f => ([{
                text: f.name,
                callback_data: "file_" + encodeURIComponent(f.path)
            }]));

            return bot.sendMessage(id, "📂 Files:", {
                reply_markup: { inline_keyboard: files }
            });

        } catch {
            return bot.sendMessage(id, "❌ File load error");
        }
    }

    // ===== FILE =====
    if (data.startsWith("file_")) {
        s.file = decodeURIComponent(data.replace("file_", ""));

        try {
            const res = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            const content = Buffer.from(res.data.content, "base64").toString();

            return bot.sendMessage(id,
`📄 ${s.file}

${content.slice(0, 1000)}`
            );

        } catch {
            return bot.sendMessage(id, "❌ File read error");
        }
    }

    bot.answerCallbackQuery(q.id);
});
