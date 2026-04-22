const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// ===== CONFIG =====
const TOKEN = "8796146859:AAGfLmvZQEVhRDVQ6clz7Xi3IeezYiXtwZs";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("✅ Bot Started");

// ===== ERROR SAFETY =====
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

    const userData = {
        id: id,
        name: msg.from.first_name || "NoName",
        username: msg.from.username || "NoUsername"
    };

    const exists = db.users.find(u => u.id === id);

    if (!exists) {
        db.users.push(userData);
        saveDB();

        bot.sendMessage(OWNER_ID,
`👤 New User

🆔 ${userData.id}
👤 ${userData.name}
🔗 @${userData.username}`);
    }

    menu(id);
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 DIE GITHUB MANAGER PRO", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "🤖 AI Fix", callback_data: "ai" }]
            ]
        }
    });
}

// ===== USERS LIST =====
bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    let list = db.users.map((u, i) =>
`${i + 1}. ${u.name}
🆔 ${u.id}
👤 @${u.username}`
    ).join("\n\n");

    if (list.length > 4000) list = list.slice(0, 4000);

    bot.sendMessage(msg.chat.id,
`👥 Total Users: ${db.users.length}

${list}`);
});

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    bot.sendMessage(msg.chat.id, `👥 Users: ${db.users.length}`);
});

// ===== UPDATE =====
bot.onText(/\/update (.+)/, async (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    let success = 0, fail = 0;

    for (let u of db.users) {
        try {
            await bot.sendMessage(u.id, `🚀 UPDATE\n\n${match[1]}`);
            success++;
        } catch {
            fail++;
        }
    }

    bot.sendMessage(msg.chat.id, `✅ ${success}\n❌ ${fail}`);
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;
    const s = getSession(id);

    try {

        if (!s.token) {
            return bot.sendMessage(id, "🔑 Send GitHub token");
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

            files.push([{ text: "📤 Upload", callback_data: "upload" }]);

            return bot.sendMessage(id, "📂 Files:", {
                reply_markup: { inline_keyboard: files }
            });
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

            return bot.sendMessage(id, "⚙️ Options:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 Delete", callback_data: "delete" }],
                        [{ text: "📤 Upload", callback_data: "upload" }]
                    ]
                }
            });
        }

        // ===== DELETE =====
        if (data === "delete") {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.delete(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                {
                    headers: { Authorization: `Bearer ${s.token}` },
                    data: { message: "delete", sha: fileData.data.sha }
                }
            );

            bot.sendMessage(id, "✅ Deleted");
        }

        // ===== UPLOAD =====
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
    const id = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    const s = getSession(id);

    try {

        // LOGIN
        if (!s.token) {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${text}` }
            });

            s.token = text;
            s.username = user.data.login;

            return bot.sendMessage(id, "✅ Logged in");
        }

        // CREATE REPO
        if (s.create) {
            await axios.post(
                "https://api.github.com/user/repos",
                { name: text },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            s.repo = text;
            s.create = false;

            return bot.sendMessage(id, "✅ Repo Created", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📤 Add Files", callback_data: "upload" }]
                    ]
                }
            });
        }

        // AI
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
