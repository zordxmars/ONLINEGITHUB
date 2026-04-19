const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAHTFwspTWzafSYfX3wO3YOGUr54kUXZFas";
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
    bot.sendMessage(chatId, "🚀 *GitHub Manager ULTRA*", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login", callback_data: "login" }],
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "🔍 Search Repo", callback_data: "search_repo" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "📢 Help", callback_data: "help" }]
            ]
        }
    });
}

// ===== BROADCAST COMMAND =====
bot.onText(/\/broadcast (.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    const text = match[1];

    db.users.forEach(id => {
        bot.sendMessage(id, `📢 Broadcast:\n\n${text}`).catch(() => {});
    });

    bot.sendMessage(msg.chat.id, "✅ Broadcast Sent");
});

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    bot.sendMessage(msg.chat.id,
        `👥 Users: ${db.users.length}\n✅ Approved: ${db.approved.length}`
    );
});

// ===== MESSAGE HANDLER =====
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
                path: ""
            };

            return bot.sendMessage(chatId, "✅ Logged in");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // CREATE REPO
    if (s.createRepo) {
        s.createRepo = false;
        try {
            await axios.post("https://api.github.com/user/repos",
                { name: msg.text },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );
            return bot.sendMessage(chatId, "✅ Repo Created");
        } catch {
            return bot.sendMessage(chatId, "❌ Create Failed");
        }
    }

    // SEARCH
    if (s.searchMode) {
        s.searchMode = false;
        try {
            const res = await axios.get(`https://api.github.com/search/repositories?q=${msg.text}`);
            let buttons = res.data.items.slice(0, 10).map(r => ([{
                text: r.full_name,
                callback_data: "open_public_" + encodeURIComponent(r.full_name)
            }]));
            return bot.sendMessage(chatId, "🔍 Results:", {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch {
            return bot.sendMessage(chatId, "❌ Search failed");
        }
    }

    // RENAME
    if (s.renameMode) {
        const newName = msg.text;
        s.renameMode = false;

        try {
            const fileData = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.put(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${newName}`,
                {
                    message: "rename",
                    content: fileData.data.content,
                    sha: fileData.data.sha
                },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.delete(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                {
                    headers: { Authorization: `Bearer ${s.token}` },
                    data: { message: "remove old", sha: fileData.data.sha }
                }
            );

            bot.sendMessage(chatId, "✅ Renamed");
        } catch {
            bot.sendMessage(chatId, "❌ Rename failed");
        }
    }
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    if (data.startsWith("approve_")) {
        let id = parseInt(data.split("_")[1]);
        if (!db.approved.includes(id)) {
            db.approved.push(id);
            saveDB();
        }
        bot.sendMessage(id, "✅ Approved");
        return;
    }

    if (data.startsWith("reject_")) {
        let id = parseInt(data.split("_")[1]);
        bot.sendMessage(id, "❌ Rejected");
        return;
    }

    let s = sessions[chatId];
    if (!s) return bot.sendMessage(chatId, "Login first");

    if (data === "help") {
        return bot.sendMessage(chatId,
`📖 HOW TO USE

1. Login → Send GitHub token  
2. My Repos → Select repo  
3. Click file → manage  
4. Upload → send file  

Admin:
 /broadcast msg
 /stats`
        );
    }

    if (data === "create_repo") {
        s.createRepo = true;
        return bot.sendMessage(chatId, "Send repo name");
    }

    if (data === "search_repo") {
        s.searchMode = true;
        return bot.sendMessage(chatId, "Send repo name");
    }

    if (data === "repos") {
        const res = await axios.get("https://api.github.com/user/repos", {
            headers: { Authorization: `Bearer ${s.token}` }
        });

        let buttons = res.data.map(r => ([{
            text: r.name,
            callback_data: "repo_" + encodeURIComponent(r.name)
        }]));

        return bot.sendMessage(chatId, "Your repos:", {
            reply_markup: { inline_keyboard: buttons }
        });
    }

    if (data.startsWith("repo_")) {
        s.repo = decodeURIComponent(data.split("_")[1]);
        s.path = "";
        return loadFiles(chatId);
    }

    if (data.startsWith("file_")) {
        const path = decodeURIComponent(data.split("_")[1]);
        s.file = path;

        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${path}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        let content = Buffer.from(res.data.content, "base64").toString();

        bot.sendMessage(chatId, `📄 ${path}\n\n${content.slice(0, 3000)}`);

        bot.sendMessage(chatId, "Options:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Rename", callback_data: "rename" }],
                    [{ text: "⬇️ Download", callback_data: "download" }],
                    [{ text: "🗑 Delete", callback_data: "delete" }]
                ]
            }
        });
    }

    if (data === "rename") {
        s.renameMode = true;
        bot.sendMessage(chatId, "Send new name");
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

            bot.sendMessage(chatId, "Deleted");
            loadFiles(chatId);
        } catch {
            bot.sendMessage(chatId, "Delete failed");
        }
    }
});

// ===== FILE LOADER =====
async function loadFiles(chatId) {
    let s = sessions[chatId];

    const res = await axios.get(
        `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.path}`,
        { headers: { Authorization: `Bearer ${s.token}` } }
    );

    let buttons = res.data.map(i => ([{
        text: (i.type === "dir" ? "📂 " : "📄 ") + i.name,
        callback_data: (i.type === "dir" ? "file_" : "file_") + encodeURIComponent(i.path)
    }]));

    bot.sendMessage(chatId, "Files:", {
        reply_markup: { inline_keyboard: buttons }
    });
}