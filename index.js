const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAFsaQNdcDHd5Qn7QSlNmX1S33LdArSj0fo";
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
    bot.sendMessage(chatId, "🚀 *GitHub Manager*", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login", callback_data: "login" }],
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "📢 Help", callback_data: "help" }]
            ]
        }
    });
}

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;
    if (!db.approved.includes(chatId)) return;

    // ✅ AUTO LOGIN FIX
    if (!sessions[chatId] && db.tokens[chatId]) {
        sessions[chatId] = db.tokens[chatId];
    }

    let s = sessions[chatId] || {};

    // ===== LOGIN =====
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${msg.text}` }
            });

            sessions[chatId] = {
                token: msg.text,
                username: user.data.login
            };

            // ✅ SAVE TOKEN (FIX)
            db.tokens[chatId] = {
                token: msg.text,
                username: user.data.login
            };
            saveDB();

            return bot.sendMessage(chatId, "✅ Logged in\nUse buttons");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // ===== EDIT FILE =====
    if (s.editMode) {
        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.put(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                {
                    message: "edit via bot",
                    content: Buffer.from(msg.text).toString("base64"),
                    sha: fileData.data.sha
                },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            bot.sendMessage(chatId, "✅ Updated");
        } catch {
            bot.sendMessage(chatId, "❌ Edit failed");
        }

        s.editMode = false;
        return;
    }
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // ===== APPROVE =====
    if (data.startsWith("approve_")) {
        const id = parseInt(data.split("_")[1]);
        if (!db.approved.includes(id)) {
            db.approved.push(id);
            saveDB();
        }
        bot.sendMessage(id, "✅ Approved");
        return;
    }

    // ===== REJECT =====
    if (data.startsWith("reject_")) {
        const id = parseInt(data.split("_")[1]);
        bot.sendMessage(id, "❌ Rejected");
        return;
    }

    // ✅ AUTO LOGIN FIX (CALLBACK)
    if (!sessions[chatId] && db.tokens[chatId]) {
        sessions[chatId] = db.tokens[chatId];
    }

    let s = sessions[chatId];

    if (!s?.token) {
        return bot.sendMessage(chatId, "🔑 Please login first");
    }

    // ===== HELP =====
    if (data === "help") {
        return bot.sendMessage(chatId,
`📖 HOW TO USE

1. Login → send GitHub token
2. My Repos → select repo
3. Click file → manage
4. Upload → send file

AI:
🤖 Analyze code

Admin:
/broadcast msg
/stats`);
    }

    // ===== REPOS =====
    if (data === "repos") {
        const res = await axios.get("https://api.github.com/user/repos", {
            headers: { Authorization: `Bearer ${s.token}` }
        });

        let buttons = res.data.map(r => ([{
            text: "📁 " + r.name,
            callback_data: "repo_" + encodeURIComponent(r.name)
        }]));

        return bot.sendMessage(chatId, "📂 Repos:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // ===== SELECT REPO =====
    if (data.startsWith("repo_")) {
        s.repo = decodeURIComponent(data.split("_")[1]);

        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        let buttons = res.data.map(f => ([{
            text: "📄 " + f.name,
            callback_data: "file_" + encodeURIComponent(f.path)
        }]));

        buttons.push([{ text: "📤 Upload File", callback_data: "upload" }]);

        bot.sendMessage(chatId, "📂 Files:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // ===== FILE =====
    if (data.startsWith("file_")) {
        const path = decodeURIComponent(data.split("_")[1]);
        s.file = path;

        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${path}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        const content = Buffer.from(res.data.content, "base64").toString();

        bot.sendMessage(chatId,
`📄 ${path}

${content.slice(0, 1500)}`);

        bot.sendMessage(chatId, "⚙️ Options:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Edit", callback_data: "edit" }],
                    [{ text: "⬇️ Download", callback_data: "download" }],
                    [{ text: "🗑 Delete", callback_data: "delete" }],
                    [{ text: "🤖 Analyze", callback_data: "ai" }]
                ]
            }
        });
    }

    // ===== UPLOAD BUTTON =====
    if (data === "upload") {
        s.uploadMode = true;
        return bot.sendMessage(chatId, "📤 Send file to upload");
    }

    // ===== AI ANALYZE =====
    if (data === "ai") {
        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            const content = Buffer.from(fileData.data.content, "base64").toString();

            const ai = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: "Analyze this code:\n" + content }]
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_KEY}`
                    }
                }
            );

            bot.sendMessage(chatId, ai.data.choices[0].message.content);

        } catch {
            bot.sendMessage(chatId, "❌ AI failed");
        }
    }

    bot.answerCallbackQuery(q.id);
});

// ===== UPLOAD =====
bot.on("document", async (msg) => {
    const chatId = msg.chat.id;

    if (!db.approved.includes(chatId)) return;

    let s = sessions[chatId];
    if (!s || !s.uploadMode) return;

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

        bot.sendMessage(chatId, "✅ Uploaded");

    } catch {
        bot.sendMessage(chatId, "❌ Upload failed");
    }

    s.uploadMode = false;
});
