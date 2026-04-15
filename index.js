const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TOKEN = "8756785571:AAG3Hkz4l-2RhM0toN1R5q9n6vsTl8OF164";
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

    // अगर approved नहीं है
    if (!approvedUsers.has(chatId)) {

        bot.sendMessage(OWNER_ID, `
📩 Access Request

👤 ${name}
🆔 ${chatId}
`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Approve", callback_data: "approve_" + chatId },
                        { text: "❌ Reject", callback_data: "reject_" + chatId }
                    ]
                ]
            }
        });

        return bot.sendMessage(chatId, "⏳ Waiting for admin approval...");
    }

    bot.sendMessage(chatId, `
🚀 *GitPushBot | GitHub Manager*
━━━━━━━━━━━━━━━━━━━━━━

Hello, *${name}*! 👋

Send GitHub PAT to login.

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

// OWNER USERS PANEL
bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    let buttons = [...users].map(id => ([{
        text: `👤 ${id}`,
        callback_data: "user_" + id
    }]));

    bot.sendMessage(msg.chat.id, "👥 Select User:", {
        reply_markup: { inline_keyboard: buttons }
    });
});

// BROADCAST
bot.onText(/\/broadcast (.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    users.forEach(id => {
        bot.sendMessage(id, `📢 ${match[1]}`);
    });
});

// STATS
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    bot.sendMessage(msg.chat.id, `👥 Users: ${users.size}`);
});

// MESSAGE HANDLER
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;

    // BLOCK NON APPROVED
    if (!approvedUsers.has(chatId)) return;

    // OWNER DELETE MODE
    if (sessions[chatId]?.ownerDeleteMode) {
        const targetId = sessions[chatId].targetUser;
        const fileName = msg.text;

        if (!sessions[targetId]) return bot.sendMessage(chatId, "❌ User not found");

        const s = sessions[targetId];

        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${fileName}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.delete(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${fileName}`,
                {
                    headers: { Authorization: `Bearer ${s.token}` },
                    data: { message: "Deleted by owner", sha: fileData.data.sha }
                }
            );

            bot.sendMessage(chatId, `✅ Deleted: ${fileName}`);
            bot.sendMessage(targetId, `⚠️ Owner deleted: ${fileName}`);

        } catch {
            bot.sendMessage(chatId, "❌ Delete failed");
        }

        sessions[chatId].ownerDeleteMode = false;
        return;
    }

    // USER DELETE MODE
    if (sessions[chatId]?.deleteMode) {
        const fileName = msg.text;

        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                { headers: { Authorization: `Bearer ${sessions[chatId].token}` }
            });

            await axios.delete(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                {
                    headers: { Authorization: `Bearer ${sessions[chatId].token}` },
                    data: { message: "Deleted", sha: fileData.data.sha }
                }
            );

            bot.sendMessage(chatId, `✅ Deleted: ${fileName}`);

        } catch {
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
            callback_data: "repo_" + r.name
        }]));

        bot.sendMessage(chatId, "📂 Select Repo:", {
            reply_markup: { inline_keyboard: buttons }
        });

    } catch {
        bot.sendMessage(chatId, "❌ Invalid Token");
    }
});

// CALLBACK (ALL IN ONE)
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

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
        bot.sendMessage(chatId, `❌ Rejected: ${userId}`);
    }

    if (data === "how") {
        return bot.sendMessage(chatId, "Send token → select repo → upload/delete");
    }

    if (data.startsWith("user_")) {
        const targetId = data.replace("user_", "");

        sessions[chatId] = sessions[chatId] || {};
        sessions[chatId].targetUser = targetId;

        bot.sendMessage(chatId, `👤 User: ${targetId}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🗑 Delete File", callback_data: "owner_delete" }]
                ]
            }
        });
    }

    if (data === "owner_delete") {
        sessions[chatId].ownerDeleteMode = true;
        bot.sendMessage(chatId, "🗑 Send file name");
    }

    if (data.startsWith("repo_")) {
        const repo = data.replace("repo_", "");
        sessions[chatId].repo = repo;

        bot.sendMessage(chatId, `📁 Repo: ${repo}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Upload" }],
                    [{ text: "🗑 Delete File", callback_data: "delete" }]
                ]
            }
        });
    }

    if (data === "delete") {
        sessions[chatId].deleteMode = true;
        bot.sendMessage(chatId, "🗑 Send file name");
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

    } catch {
        bot.sendMessage(chatId, "❌ Upload failed");
    }
});

// LOGOUT
bot.onText(/\/logout/, (msg) => {
    delete sessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Logged out");
});