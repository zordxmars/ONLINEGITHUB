const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TOKEN = "8796146859:AAEXNEvKwSdmi9ta0GLxc8FY9VJF4FiggX0";
const OWNER_ID = 8721643962;

const bot = new TelegramBot(TOKEN, { polling: true });

let sessions = {};
let users = new Set();
let approvedUsers = new Set();

// START MENU
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
Choose an option below 👇

⚡ Bot made by *DIE*
`, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login (Send Token)", callback_data: "login_info" }],
                [{ text: "📁 My Repos", callback_data: "my_repos" }],
                [{ text: "🔍 Search Repo", callback_data: "search_repo" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
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

    // SEARCH MODE
    if (sessions[chatId].searchMode) {
        const keyword = msg.text.toLowerCase();

        try {
            const res = await axios.get("https://api.github.com/user/repos", {
                headers: { Authorization: `Bearer ${sessions[chatId].token}` }
            });

            const filtered = res.data.filter(r =>
                r.name.toLowerCase().includes(keyword)
            );

            if (filtered.length === 0) {
                bot.sendMessage(chatId, "❌ No repo found");
            } else {
                let buttons = filtered.map(r => ([{
                    text: "📁 " + r.name,
                    callback_data: "repo_" + encodeURIComponent(r.name)
                }]));

                bot.sendMessage(chatId, "🔍 Results:", {
                    reply_markup: { inline_keyboard: buttons }
                });
            }

        } catch {
            bot.sendMessage(chatId, "❌ Search failed");
        }

        sessions[chatId].searchMode = false;
        return;
    }

    // CREATE REPO
    if (sessions[chatId].createRepoMode) {
        const repoName = msg.text;

        try {
            await axios.post(
                "https://api.github.com/user/repos",
                { name: repoName, private: false, auto_init: true },
                { headers: { Authorization: `Bearer ${sessions[chatId].token}` } }
            );

            bot.sendMessage(chatId, `✅ Repo created: ${repoName}`);
        } catch {
            bot.sendMessage(chatId, "❌ Create failed");
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

    // LOGIN (TOKEN)
    try {
        const user = await axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${msg.text}` }
        });

        sessions[chatId] = {
            token: msg.text,
            username: user.data.login,
            repo: null
        };

        bot.sendMessage(chatId, "✅ Login successful! Now use 'My Repos'");
    } catch {
        bot.sendMessage(chatId, "❌ Invalid Token");
    }
});

// CALLBACK
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // APPROVE
    if (data.startsWith("approve_")) {
        const id = parseInt(data.replace("approve_", ""));
        approvedUsers.add(id);
        bot.sendMessage(id, "✅ Approved! Use /start");
    }

    // REMOVE USER
    if (data.startsWith("remove_")) {
        const id = parseInt(data.replace("remove_", ""));
        approvedUsers.delete(id);
        delete sessions[id];
        bot.sendMessage(id, "❌ Access removed");
    }

    // LOGIN INFO
    if (data === "login_info") {
        return bot.sendMessage(chatId, "🔑 Send GitHub PAT to login");
    }

    // MY REPOS
    if (data === "my_repos") {
        const s = sessions[chatId];

        if (!s || !s.token) {
            return bot.sendMessage(chatId, "❌ पहले login करो");
        }

        try {
            const repos = await axios.get("https://api.github.com/user/repos", {
                headers: { Authorization: `Bearer ${s.token}` }
            });

            let buttons = repos.data.map(r => ([{
                text: "📁 " + r.name,
                callback_data: "repo_" + encodeURIComponent(r.name)
            }]));

            buttons.push([{ text: "🔍 Search Repo", callback_data: "search_repo" }]);
            buttons.push([{ text: "➕ Create Repo", callback_data: "create_repo" }]);

            bot.sendMessage(chatId, "📂 Your Repos:", {
                reply_markup: { inline_keyboard: buttons }
            });

        } catch {
            bot.sendMessage(chatId, "❌ Failed to load repos");
        }
    }

    // SEARCH BUTTON
    if (data === "search_repo") {
        sessions[chatId].searchMode = true;
        bot.sendMessage(chatId, "🔍 Send repo name:");
    }

    // SELECT REPO
    if (data.startsWith("repo_")) {
        const repo = decodeURIComponent(data.replace("repo_", ""));
        sessions[chatId].repo = repo;

        bot.sendMessage(chatId, `📁 Repo: ${repo}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Upload", callback_data: "upload" }],
                    [{ text: "🗑 Delete", callback_data: "delete" }]
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
        bot.sendMessage(chatId, "📤 Send file");
    }

    if (data === "how") {
        bot.sendMessage(chatId, `
📖 How To Use

1. Send token  
2. Click My Repos  
3. Upload/Delete  

⚡ Bot made by DIE
`);
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
    bot.sendMessage(msg.chat.id, "🔒 Logged out");
});