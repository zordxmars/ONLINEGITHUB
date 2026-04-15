const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TOKEN = "8796146859:AAEEnikkSyWxLwgWvmSCT_k8BGE4FgyB9RM";
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

// USERS PANEL
bot.onText(/\/users/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    let buttons = [...users].map(id => ([{
        text: `👤 ${id}`,
        callback_data: "user_" + id
    }]));

    bot.sendMessage(msg.chat.id, "👥 Users:", {
        reply_markup: { inline_keyboard: buttons }
    });
});

// MESSAGE HANDLER
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;

    if (!approvedUsers.has(chatId)) return;

    // DELETE MODE
    if (sessions[chatId]?.deleteMode) {
        const fileName = msg.text;

        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                { headers: { Authorization: `token ${sessions[chatId].token}` } }
            );

            await axios.delete(
                `https://api.github.com/repos/${sessions[chatId].username}/${sessions[chatId].repo}/contents/${fileName}`,
                {
                    headers: { Authorization: `token ${sessions[chatId].token}` },
                    data: { message: "Deleted", sha: fileData.data.sha }
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
            headers: { Authorization: `token ${msg.text}` }
        });

        sessions[chatId] = {
            token: msg.text,
            username: user.data.login,
            repo: null
        };

        const repos = await axios.get("https://api.github.com/user/repos", {
            headers: { Authorization: `token ${msg.text}` }
        });

        let buttons = repos.data.map(r => ([{
            text: "📁 " + r.name,
            callback_data: "repo_" + encodeURIComponent(r.name)
        }]));

        bot.sendMessage(chatId, "📂 Select Repo:", {
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (err) {
        console.log(err.response?.data || err.message);
        bot.sendMessage(chatId, "❌ Invalid Token / Repo error");
    }
});

// CALLBACK
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    console.log("CLICK:", data);

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

    // REPO SELECT
    if (data.startsWith("repo_")) {
        const repo = decodeURIComponent(data.replace("repo_", ""));

        sessions[chatId] = sessions[chatId] || {};
        sessions[chatId].repo = repo;

        bot.sendMessage(chatId, `📁 Repo Selected: ${repo}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Upload", callback_data: "upload" }],
                    [{ text: "🗑 Delete File", callback_data: "delete" }]
                ]
            }
        });
    }

    // DELETE BUTTON
    if (data === "delete") {
        sessions[chatId].deleteMode = true;
        bot.sendMessage(chatId, "🗑 Send file name (example: index.js)");
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
            { headers: { Authorization: `token ${s.token}` } }
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