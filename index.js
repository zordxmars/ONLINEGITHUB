const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAFfIXCV5KyvmqUqZ7qB5nD3QGo41v0H5Y4";
const OWNER_ID = 8721643962;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DATABASE =====
let db = { users: [], approved: [] };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

// ===== SESSIONS =====
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

    bot.sendMessage(chatId, "🚀 GitHub Panel\n\nSend GitHub Token to login");
});

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
                username: user.data.login,
                repo: "",
                file: ""
            };

            return bot.sendMessage(chatId, "✅ Logged in\nUse /repos");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // EDIT
    if (s.editMode) {
        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.put(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                {
                    message: "edit",
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

// ===== REPOS =====
bot.onText(/\/repos/, async (msg) => {
    const chatId = msg.chat.id;
    const s = sessions[chatId];

    if (!s) return bot.sendMessage(chatId, "Login first");

    const res = await axios.get("https://api.github.com/user/repos", {
        headers: { Authorization: `Bearer ${s.token}` }
    });

    let buttons = res.data.map(r => ([{
        text: "📁 " + r.name,
        callback_data: "repo_" + encodeURIComponent(r.name)
    }]));

    bot.sendMessage(chatId, "📂 Repos:", {
        reply_markup: { inline_keyboard: buttons }
    });
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    let s = sessions[chatId];

    if (!s) return bot.sendMessage(chatId, "Login first");

    // APPROVE
    if (data.startsWith("approve_")) {
        const id = parseInt(data.split("_")[1]);
        db.approved.push(id);
        saveDB();
        bot.sendMessage(id, "✅ Approved");
        return;
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

        // 👉 UPLOAD BUTTON HERE
        buttons.push([{ text: "📤 Upload File", callback_data: "upload_file" }]);

        bot.sendMessage(chatId, "📂 Files:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // FILE OPEN
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

${content.slice(0,1500)}`);

        bot.sendMessage(chatId, "⚙️ Options:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Edit", callback_data: "edit" }],
                    [{ text: "⬇️ Download", callback_data: "download" }],
                    [{ text: "🗑 Delete", callback_data: "delete" }],
                    [{ text: "📤 Upload File", callback_data: "upload_file" }]
                ]
            }
        });
    }

    if (data === "upload_file") {
        bot.sendMessage(chatId, "📤 Send file to upload");
    }

    if (data === "edit") {
        s.editMode = true;
        bot.sendMessage(chatId, "Send new content");
    }

    if (data === "download") {
        const url = `https://raw.githubusercontent.com/${s.username}/${s.repo}/main/${s.file}`;
        bot.sendMessage(chatId, url);
    }

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
