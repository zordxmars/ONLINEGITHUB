const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const TOKEN = "8796146859:AAF4RC8XuKZ0tXGigz7uzuQyzZgvn2x5SKk";
const OWNER_ID = 8721643962;

const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== DB =====
let db = { users: [], approved: [], tokens: {} };
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

    if (!db.approved.includes(id)) {
        bot.sendMessage(OWNER_ID, `📩 Request: ${id}`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Approve", callback_data: "approve_" + id },
                    { text: "❌ Reject", callback_data: "reject_" + id }
                ]]
            }
        });
        return bot.sendMessage(id, "⏳ Waiting approval...");
    }

    menu(id);
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 GitHub Manager + AI", {
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

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const id = msg.chat.id;
    if (!db.approved.includes(id)) return;

    if (!sessions[id] && db.tokens[id]) {
        sessions[id] = db.tokens[id];
    }

    let s = sessions[id] || {};

    // AI CHAT
    if (s.aiMode) {
        try {
            const res = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: msg.text }]
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_KEY}`
                    }
                }
            );

            return bot.sendMessage(id, res.data.choices[0].message.content);
        } catch (e) {
            console.log(e.response?.data || e.message);
            return bot.sendMessage(id, "❌ AI error");
        }
    }

    // LOGIN
    if (!s.token) {
        try {
            const user = await axios.get("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${msg.text}`,
                    "User-Agent": "bot"
                }
            });

            sessions[id] = {
                token: msg.text,
                username: user.data.login
            };

            db.tokens[id] = sessions[id];
            saveDB();

            return bot.sendMessage(id, "✅ Logged in");
        } catch {
            return bot.sendMessage(id, "❌ Invalid Token");
        }
    }

    // CREATE NAME
    if (s.createStep === "name") {
        s.repoName = msg.text;
        s.createStep = "visibility";

        return bot.sendMessage(id, "Select type:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Public", callback_data: "repo_public" }],
                    [{ text: "Private", callback_data: "repo_private" }]
                ]
            }
        });
    }

    // EDIT MODE
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

    if (!sessions[id] && db.tokens[id]) {
        sessions[id] = db.tokens[id];
    }

    let s = sessions[id];

    // AI CHAT BUTTON
    if (data === "ai_chat") {
        sessions[id] = sessions[id] || {};
        sessions[id].aiMode = true;
        return bot.sendMessage(id, "🤖 AI ON (use /start to exit)");
    }

    if (!s?.token) {
        return bot.sendMessage(id, "Login first");
    }

    // REPOS
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

    // REPO CLICK → FILES FIX
    if (data.startsWith("repo_")) {
        s.repo = decodeURIComponent(data.replace("repo_", ""));

        try {
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

        } catch (e) {
            console.log(e.response?.data);
            bot.sendMessage(id, "❌ File load error");
        }
    }

    // FILE CLICK
    if (data.startsWith("file_")) {
        s.file = decodeURIComponent(data.replace("file_", ""));

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

    // AI FILE ANALYZE FIX
    if (data === "ai_file") {
        try {
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
                    headers: {
                        Authorization: `Bearer ${OPENAI_KEY}`
                    }
                }
            );

            bot.sendMessage(id, ai.data.choices[0].message.content);
        } catch (e) {
            console.log(e.response?.data || e.message);
            bot.sendMessage(id, "❌ AI analyze error");
        }
    }

    bot.answerCallbackQuery(q.id);
});
