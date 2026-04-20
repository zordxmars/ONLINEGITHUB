const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8686861247:AAEEeKnEwcYpqAgM57qpnnO4BbV6bffI28o";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DB =====
let db = { users: [], approved: [], pending: [], tokens: {} };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

let sessions = {};

// ===== START =====
bot.onText(/\/start/, (msg) => {
    const id = msg.chat.id;

    if (!db.users.includes(id)) {
        db.users.push(id);
        saveDB();
    }

    // approved → menu
    if (db.approved.includes(id)) {
        return menu(id);
    }

    // already requested
    if (db.pending.includes(id)) {
        return bot.sendMessage(id, "⏳ Already requested, wait...");
    }

    db.pending.push(id);
    saveDB();

    bot.sendMessage(OWNER_ID, `📩 Request: ${id}`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: "approve_" + id },
                { text: "❌ Reject", callback_data: "reject_" + id }
            ]]
        }
    });

    bot.sendMessage(id, "⏳ Waiting for approval...");
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 *GitHub Manager PRO*", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Login", callback_data: "login" }],
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "🤖 AI Chat", callback_data: "ai_chat" }]
            ]
        }
    });
}

// ===== ADMIN =====
bot.onText(/\/stats/, (msg) => {
    if (msg.chat.id !== OWNER_ID) return;
    bot.sendMessage(msg.chat.id,
        `👥 Users: ${db.users.length}\n✅ Approved: ${db.approved.length}\n⏳ Pending: ${db.pending.length}`
    );
});

bot.onText(/\/broadcast (.+)/, (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;
    db.users.forEach(id => bot.sendMessage(id, match[1]).catch(() => {}));
    bot.sendMessage(msg.chat.id, "✅ Sent");
});

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const id = msg.chat.id;
    if (!db.approved.includes(id)) return;

    // restore session
    if (!sessions[id] && db.tokens[id]) {
        sessions[id] = db.tokens[id];
    }

    let s = sessions[id] || {};

    // AI chat
    if (s.aiMode) {
        try {
            const ai = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: msg.text }]
                },
                {
                    headers: { Authorization: `Bearer ${OPENAI_KEY}` }
                }
            );

            return bot.sendMessage(id, ai.data.choices[0].message.content);
        } catch {
            return bot.sendMessage(id, "❌ AI error");
        }
    }

    // login
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${msg.text}` }
            });

            sessions[id] = {
                token: msg.text,
                username: user.data.login
            };

            db.tokens[id] = sessions[id];
            saveDB();

            return bot.sendMessage(id, "✅ Logged in");
        } catch {
            return bot.sendMessage(id, "❌ Invalid token");
        }
    }

    // repo create step
    if (s.createStep === "name") {
        s.repoName = msg.text;
        s.createStep = "visibility";

        return bot.sendMessage(id, "Select:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Public", callback_data: "repo_public" }],
                    [{ text: "Private", callback_data: "repo_private" }]
                ]
            }
        });
    }

    // edit file
    if (s.editMode) {
        try {
            const file = await axios.get(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            await axios.put(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
                {
                    message: "edit",
                    content: Buffer.from(msg.text).toString("base64"),
                    sha: file.data.sha
                },
                { headers: { Authorization: `Bearer ${s.token}` } }
            );

            bot.sendMessage(id, "✅ Updated");
        } catch {
            bot.sendMessage(id, "❌ Edit failed");
        }

        s.editMode = false;
    }
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;

    // approve
    if (data.startsWith("approve_")) {
        const uid = parseInt(data.split("_")[1]);
        db.approved.push(uid);
        db.pending = db.pending.filter(x => x !== uid);
        saveDB();
        bot.sendMessage(uid, "✅ Approved /start");
        return;
    }

    // restore session
    if (!sessions[id] && db.tokens[id]) {
        sessions[id] = db.tokens[id];
    }

    let s = sessions[id];

    if (data === "ai_chat") {
        sessions[id] = sessions[id] || {};
        sessions[id].aiMode = true;
        return bot.sendMessage(id, "🤖 AI ON");
    }

    if (!s?.token) return bot.sendMessage(id, "🔑 Login first");

    // repos
    if (data === "repos") {
        const res = await axios.get("https://api.github.com/user/repos", {
            headers: { Authorization: `Bearer ${s.token}` }
        });

        let btn = res.data.map(r => ([{
            text: r.name,
            callback_data: "repo_" + encodeURIComponent(r.name)
        }]));

        return bot.sendMessage(id, "Repos:", {
            reply_markup: { inline_keyboard: btn }
        });
    }

    // repo → files
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

        return bot.sendMessage(id, "Files:", {
            reply_markup: { inline_keyboard: files }
        });
    }

    // file
    if (data.startsWith("file_")) {
        s.file = decodeURIComponent(data.split("_")[1]);

        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        const content = Buffer.from(res.data.content, "base64").toString();

        bot.sendMessage(id, content.slice(0, 1500));

        bot.sendMessage(id, "Options:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Edit", callback_data: "edit" }],
                    [{ text: "Delete", callback_data: "delete" }],
                    [{ text: "Download", callback_data: "download" }],
                    [{ text: "🤖 Analyze", callback_data: "ai_file" }]
                ]
            }
        });
    }

    // edit
    if (data === "edit") {
        s.editMode = true;
        bot.sendMessage(id, "Send new content");
    }

    // delete
    if (data === "delete") {
        const file = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        await axios.delete(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
            {
                headers: { Authorization: `Bearer ${s.token}` },
                data: { message: "delete", sha: file.data.sha }
            }
        );

        bot.sendMessage(id, "✅ Deleted");
    }

    // download
    if (data === "download") {
        bot.sendMessage(id,
            `https://raw.githubusercontent.com/${s.username}/${s.repo}/main/${s.file}`
        );
    }

    // AI analyze
    if (data === "ai_file") {
        const res = await axios.get(
            `https://api.github.com/repos/${s.username}/${s.repo}/contents/${s.file}`,
            { headers: { Authorization: `Bearer ${s.token}` } }
        );

        const code = Buffer.from(res.data.content, "base64").toString();

        const ai = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: code }]
            },
            {
                headers: { Authorization: `Bearer ${OPENAI_KEY}` }
            }
        );

        bot.sendMessage(id, ai.data.choices[0].message.content);
    }

    // upload
    if (data === "upload") {
        s.upload = true;
        bot.sendMessage(id, "Send file");
    }

    bot.answerCallbackQuery(q.id);
});

// upload handler
bot.on("document", async (msg) => {
    const id = msg.chat.id;
    let s = sessions[id];
    if (!s?.upload) return;

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
    s.upload = false;
});
