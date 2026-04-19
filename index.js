const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAH52gw2BtrR0T6ILfzEo0cIxhxdd24e7z4";
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

// ===== BROADCAST =====
bot.onText(/\/broadcast (.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    db.users.forEach(id => {
        bot.sendMessage(id, `📢 ${match[1]}`).catch(() => {});
    });

    bot.sendMessage(msg.chat.id, "✅ Broadcast sent");
});

// ===== STATS =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    bot.sendMessage(msg.chat.id,
        `👥 Users: ${db.users.length}\n✅ Approved: ${db.approved.length}`
    );
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
                username: user.data.login
            };

            return bot.sendMessage(chatId, "✅ Logged in\nUse buttons");
        } catch {
            return bot.sendMessage(chatId, "❌ Invalid Token");
        }
    }

    // CREATE REPO STEP NAME
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

    if (data.startsWith("approve_")) {
        const id = parseInt(data.split("_")[1]);
        db.approved.push(id);
        saveDB();
        bot.sendMessage(id, "✅ Approved");
        return;
    }

    if (data.startsWith("reject_")) {
        const id = parseInt(data.split("_")[1]);
        bot.sendMessage(id, "❌ Rejected");
        return;
    }

    let s = sessions[chatId];
    if (!s) return bot.sendMessage(chatId, "Login first");

    // HELP
    if (data === "help") {
        return bot.sendMessage(chatId,
`📖 HOW TO USE

1. Login → send GitHub token
2. My Repos → select repo
3. Click file → manage
4. Upload → send file

Admin:
/broadcast msg
/stats`);
    }

    // CREATE REPO
    if (data === "create_repo") {
        s.createRepoStep = "name";
        return bot.sendMessage(chatId, "📦 Send repo name:");
    }

    // FINAL CREATE
    if (data === "repo_public" || data === "repo_private") {
        const isPrivate = data === "repo_private";

        try {
            await axios.post(
                "https://api.github.com/user/repos",
                {
                    name: s.repoName,
                    private: isPrivate
                },
                {
                    headers: {
                        Authorization: `Bearer ${s.token}`,
                        "Accept": "application/vnd.github+json"
                    }
                }
            );

            bot.sendMessage(chatId,
                `✅ Repo Created:\n${s.repoName}`
            );
        } catch {
            bot.sendMessage(chatId, "❌ Create failed");
        }

        s.createRepoStep = null;
    }

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
                    [{ text: "📤 Upload", callback_data: "upload" }]
                ]
            }
        });
    }

    // UPLOAD BUTTON
    if (data === "upload") {
        return bot.sendMessage(chatId, "📤 Send file to upload");
    }

    // EDIT
    if (data === "edit") {
        s.editMode = true;
        bot.sendMessage(chatId, "Send new content");
    }

    // DOWNLOAD
    if (data === "download") {
        const url = `https://raw.githubusercontent.com/${s.username}/${s.repo}/main/${s.file}`;
        bot.sendMessage(chatId, url);
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
