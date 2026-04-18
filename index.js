const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TOKEN = "8796146859:AAH6mXo7-lqedY5tHBS9V2cJNvoWsdfzOC8";
const OWNER_ID = 8721643962;

const bot = new TelegramBot(TOKEN, { polling: true });

let sessions = {};
let users = new Set();
let approvedUsers = new Set();

// START
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || "User";

    users.add(chatId);

    if (!approvedUsers.has(chatId)) {
        bot.sendMessage(OWNER_ID, `
📩 Access Request

👤 ${name}
🆔 ${chatId}
`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Approve", callback_data: "approve_" + chatId },
                    { text: "❌ Reject", callback_data: "reject_" + chatId }
                ]]
            }
        });

        return bot.sendMessage(chatId, "⏳ Waiting for admin approval...");
    }

    bot.sendMessage(chatId, `
🚀 *GitPushBot | GitHub Manager*
━━━━━━━━━━━━━━━━━━━━━━

Hello, *${name}*! 👋

Welcome! Use buttons below to manage GitHub easily.

⚡ Bot made by *DIE*
`, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "📖 How To Use", callback_data: "how" }]
            ]
        }
    });
});

// USERS PANEL
bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    let buttons = [...users].map(id => ([
        { text: `👤 ${id}`, callback_data: "user_" + id },
        { text: "❌ Remove", callback_data: "remove_" + id }
    ]));

    bot.sendMessage(msg.chat.id, "👥 Users:", {
        reply_markup: { inline_keyboard: buttons }
    });
});

// MESSAGE HANDLER
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;
    if (!approvedUsers.has(chatId)) return;

    sessions[chatId] = sessions[chatId] || {};

    // CREATE REPO
    if (sessions[chatId].createRepoMode) {
        const repoName = msg.text;

        try {
            const res = await axios.post(
                "https://api.github.com/user/repos",
                {
                    name: repoName,
                    private: false,
                    auto_init: true
                },
                {
                    headers: {
                        Authorization: `Bearer ${sessions[chatId].token}`,
                        Accept: "application/vnd.github+json"
                    }
                }
            );

            bot.sendMessage(chatId, `✅ Repo created: ${res.data.full_name}`);
        } catch (err) {
            console.log(err.response?.data || err.message);
            bot.sendMessage(chatId, `❌ Failed: ${err.response?.data?.message || "Error"}`);
        }

        sessions[chatId].createRepoMode = false;
        return;
    }

    // DELETE FILE
    if (sessions[chatId].deleteMode) {
        const fileName = msg.text;

        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                { headers: { Authorization: `Bearer ${sessions[chatId].token}` } }
            );

            await axios.delete(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                {
                    headers: { Authorization: `Bearer ${sessions[chatId].token}` },
                    data: {
                        message: "Deleted via bot",
                        sha: fileData.data.sha
                    }
                }
            );

            bot.sendMessage(chatId, `✅ Deleted: ${fileName}`);
        } catch (err) {
            console.log(err.response?.data || err.message);
            bot.sendMessage(chatId, "❌ Delete failed");
        }

        sessions[chatId].deleteMode = false;
        return;
    }

    // LOGIN
    try {
        const user = await axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${msg.text}` }
        });

        sessions[chatId] = {
            token: msg.text,
            username: user.data.login,
            repo: null
        };

        const repos = await axios.get("https://api.github.com/user/repos", {
            headers: { Authorization: `Bearer ${msg.text}` }
        });

        let buttons = repos.data.map(r => ([{
            text: "📁 " + r.name,
            callback_data: "repo_" + encodeURIComponent(r.name)
        }]));

        buttons.push([{ text: "➕ Create Repo", callback_data: "create_repo" }]);

        bot.sendMessage(chatId, "📂 Select Repo:", {
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (err) {
        console.log(err.response?.data || err.message);
        bot.sendMessage(chatId, "❌ Invalid Token");
    }
});

// CALLBACK
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // HOW TO USE
    if (data === "how") {
        return bot.sendMessage(chatId, `
📖 *How To Use GitPushBot*
━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Get GitHub Token  
• GitHub → Settings → Developer Settings  
• Create Personal Access Token  

2️⃣ Login  
• Send token in bot  

3️⃣ Select Repo  
• Click any 📁 repo  

4️⃣ Upload  
• Click 📤 → send file  

5️⃣ Delete  
• Click 🗑 → send file name  

6️⃣ Create Repo  
• Click ➕ → send name  

7️⃣ Logout  
• Use /logout  

━━━━━━━━━━━━━━━━━━━━━━
⚡ Bot made by *DIE*
`, { parse_mode: "Markdown" });
    }

    // APPROVE
    if (data.startsWith("approve_")) {
        const userId = parseInt(data.replace("approve_", ""));
        approvedUsers.add(userId);
        bot.sendMessage(userId, "✅ Approved! Use /start");
        bot.sendMessage(chatId, `✔️ Approved: ${userId}`);
    }

    // REJECT
    if (data.startsWith("reject_")) {
        const userId = parseInt(data.replace("reject_", ""));
        bot.sendMessage(userId, "❌ Access Denied");
    }

    // REMOVE
    if (data.startsWith("remove_")) {
        const userId = parseInt(data.replace("remove_", ""));
        approvedUsers.delete(userId);
        delete sessions[userId];

        bot.sendMessage(chatId, `❌ Removed: ${userId}`);
        bot.sendMessage(userId, "🚫 Access removed");
    }

    // SELECT REPO
    if (data.startsWith("repo_")) {
        const repo = decodeURIComponent(data.replace("repo_", ""));
        sessions[chatId] = sessions[chatId] || {};
        sessions[chatId].repo = repo;

        bot.sendMessage(chatId, `📁 Repo: ${repo}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Upload", callback_data: "upload" }],
                    [{ text: "🗑 Delete", callback_data: "delete" }],
                    [{ text: "➕ Create Repo", callback_data: "create_repo" }]
                ]
            }
        });
    }

    if (data === "create_repo") {
        sessions[chatId].createRepoMode = true;
        bot.sendMessage(chatId, "📦 Send repo name:");
    }

    if (data === "delete") {
        sessions[chatId].deleteMode = true;
        bot.sendMessage(chatId, "🗑 Send file name:");
    }

    if (data === "upload") {
        bot.sendMessage(chatId, "📤 Send file to upload");
    }

    bot.answerCallbackQuery(q.id);
});

// UPLOAD
bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    if (!approvedUsers.has(chatId)) return;

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

    } catch (err) {
        console.log(err.response?.data || err.message);
        bot.sendMessage(chatId, "❌ Upload failed");
    }
});

// LOGOUT
bot.onText(/\/logout/, (msg) => {
    delete sessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "🔒 Logged out");
});