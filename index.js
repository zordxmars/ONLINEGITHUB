const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// ===== CONFIG =====
const TOKEN = "8796146859:AAGQ8cy3NJBGQE8zxNrtiawLmlNX26zR8FE";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("✅ BOT STARTED");

// ===== DATABASE =====
let db = { users: [], banned: [] };

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

// ===== SAVE USER =====
function saveUser(msg) {
    const id = msg.chat.id;

    let user = db.users.find(u => u.id === id);

    if (!user) {
        user = {
            id,
            name: msg.from.first_name || "NoName",
            username: msg.from.username || "NoUsername",
            lastActive: Date.now()
        };

        db.users.push(user);
        saveDB();

        bot.sendMessage(OWNER_ID,
`👤 New User

🆔 ${user.id}
👤 ${user.name}
🔗 @${user.username}`);
    } else {
        user.lastActive = Date.now();
        saveDB();
    }
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
    saveUser(msg);

    if (db.banned.includes(msg.chat.id)) {
        return bot.sendMessage(msg.chat.id, "🚫 You are banned");
    }

    menu(msg.chat.id);
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 GITHUB MANAGER PRO", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📁 Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create" }],
                [{ text: "🤖 AI Fix", callback_data: "ai" }]
            ]
        }
    });
}

// ===== USERS =====
bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    let list = db.users.map((u, i) =>
`${i + 1}. ${u.name}
🆔 ${u.id}
👤 @${u.username}`
    ).join("\n\n");

    bot.sendMessage(msg.chat.id,
`👥 Users: ${db.users.length}

${list.slice(0, 4000)}`);
});

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    const now = Date.now();
    const active = db.users.filter(u => now - u.lastActive < 86400000).length;

    bot.sendMessage(msg.chat.id,
`📊 STATS

👥 Total: ${db.users.length}
🟢 Active (24h): ${active}`);
});

// ===== BROADCAST =====
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    let ok = 0, fail = 0;

    for (let u of db.users) {
        try {
            await bot.sendMessage(u.id, `📢 ${match[1]}`);
            ok++;
        } catch {
            fail++;
        }
    }

    bot.sendMessage(msg.chat.id, `✅ ${ok} Sent\n❌ ${fail} Failed`);
});

// ===== BAN =====
bot.onText(/\/ban (.+)/, (msg, m) => {
    if (msg.chat.id !== OWNER_ID) return;

    const id = parseInt(m[1]);
    if (!db.banned.includes(id)) {
        db.banned.push(id);
        saveDB();
    }

    bot.sendMessage(msg.chat.id, `🚫 Banned: ${id}`);
});

// ===== UNBAN =====
bot.onText(/\/unban (.+)/, (msg, m) => {
    if (msg.chat.id !== OWNER_ID) return;

    const id = parseInt(m[1]);
    db.banned = db.banned.filter(x => x !== id);
    saveDB();

    bot.sendMessage(msg.chat.id, `✅ Unbanned: ${id}`);
});

// ===== EXPORT USERS =====
bot.onText(/\/export/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    fs.writeFileSync("users_export.json", JSON.stringify(db.users, null, 2));
    bot.sendDocument(msg.chat.id, "users_export.json");
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;
    const s = getSession(id);

    if (db.banned.includes(id)) {
        return bot.sendMessage(id, "🚫 Banned");
    }

    try {

        if (!s.token) {
            return bot.sendMessage(id, "🔑 Send GitHub token");
        }

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

            files.push([{ text: "📤 Upload", callback_data: "upload" }]);

            return bot.sendMessage(id, "📂 Files:", {
                reply_markup: { inline_keyboard: files }
            });
        }

        if (data === "upload") {
            s.upload = true;
            bot.sendMessage(id, "📤 Send file");
        }

    } catch {
        bot.sendMessage(id, "❌ Error");
    }

    bot.answerCallbackQuery(q.id);
});

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    saveUser(msg);

    const id = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    if (db.banned.includes(id)) return;

    const s = getSession(id);

    try {

        if (!s.token) {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${text}` }
            });

            s.token = text;
            s.username = user.data.login;

            return bot.sendMessage(id, "✅ Logged in");
        }

        if (s.create) {
            await axios.post(
                "https://api.github.com/user/repos",
                { name: text },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            s.create = false;
            return bot.sendMessage(id, "✅ Repo Created");
        }

        if (s.ai) {
            const res = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: text }]
                },
                {
                    headers: { Authorization: `Bearer ${OPENAI_KEY}` }
                }
            );

            bot.sendMessage(id, res.data.choices[0].message.content);
            s.ai = false;
        }

    } catch {
        bot.sendMessage(id, "❌ Error");
    }
});

// ===== FILE UPLOAD =====
bot.on("document", async (msg) => {
    const id = msg.chat.id;
    const s = getSession(id);

    if (!s.repo) return bot.sendMessage(id, "❌ Select repo first");

    try {
        const link = await bot.getFileLink(msg.document.file_id);
        const file = await axios.get(link, { responseType: "arraybuffer" });

        await axios.put(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${msg.document.file_name}`,
            {
                message: "upload",
                content: Buffer.from(file.data).toString("base64")
            },
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        bot.sendMessage(id, "✅ Uploaded");

    } catch {
        bot.sendMessage(id, "❌ Upload failed");
    }
});
