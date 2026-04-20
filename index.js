const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAEAJa6OQyM5UAXM8_ZWfz1823cIhRBw9I0";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DATABASE =====
let db = { users: [], approved: [] };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

// ===== MEMORY =====
let sessions = {};

// ===== AI FUNCTION =====
async function askAI(prompt) {
    try {
        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: {
                "Authorization": `Bearer ${OPENAI_KEY}`,
                "Content-Type": "application/json"
            }
        });

        return res.data.choices[0].message.content;
    } catch (err) {
        console.log(err.response?.data || err.message);
        return "❌ AI Error";
    }
}

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

    let s = sessions[chatId] || {};

    // LOGIN
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${msg.text}` }
            });

            sessions[chatId] = {
                token: msg.text,
                username: user.data.login
            };

            return bot.sendMessage(chatId, "✅ Logged in\nUse buttons");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // CREATE REPO
    if (s.createRepoStep === "name") {
        s.repoName = msg.text;
        s.createRepoStep = "visibility";

        return bot.sendMessage(chatId, "🔒 Select visibility:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌐 Public", callback_data: "repo_public" }],
                    [{ text: "🔐 Private", callback_data: "repo_private" }]
                ]
            }
        });
    }

    // EDIT FILE
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

    let s = sessions[chatId];
    if (!s) return bot.sendMessage(chatId, "Login first");

    // REPOS
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

    // SELECT REPO
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

        bot.sendMessage(chatId, "📂 Files:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // FILE
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
                    [{ text: "📤 Upload", callback_data: "upload" }],
                    [{ text: "🤖 Explain", callback_data: "ai_explain" }],
                    [{ text: "🛠 Fix Code", callback_data: "ai_fix" }],
                    [{ text: "⚡ Improve", callback_data: "ai_improve" }]
                ]
            }
        });
    }

    // UPLOAD BUTTON
    if (data === "upload") {
        return bot.sendMessage(chatId, "📤 Send file to upload");
    }

    // AI FEATURES
    if (data.startsWith("ai_")) {
        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        const code = Buffer.from(res.data.content, "base64").toString();

        let prompt = "";
        if (data === "ai_explain") prompt = "Explain this code:\n" + code;
        if (data === "ai_fix") prompt = "Fix bugs in this code:\n" + code;
        if (data === "ai_improve") prompt = "Improve and optimize this code:\n" + code;

        const ai = await askAI(prompt);
        return bot.sendMessage(chatId, ai);
    }

    // DOWNLOAD
    if (data === "download") {
        const url = `https://raw.githubusercontent.com/${s.username}/${s.repo}/main/${s.file}`;
        return bot.sendMessage(chatId, url);
    }

    // DELETE
    if (data === "delete") {
        try {
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

            bot.sendMessage(chatId, "✅ Deleted");
        } catch {
            bot.sendMessage(chatId, "❌ Delete failed");
        }
    }

    bot.answerCallbackQuery(q.id);
});

// ===== FILE UPLOAD =====
bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const s = sessions[chatId];

    if (!s || !s.repo) return bot.sendMessage(chatId, "Select repo first");

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
});