const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

// ===== CONFIG =====
const TOKEN = "8796146859:AAF75nu7CgMRjK-vmU3XX_QUCPawa0dSyTs";
const OWNER_ID = 8721643962;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("✅ Bot Started");

// ===== ERROR SAFETY =====
process.on("uncaughtException", err => console.log("ERROR:", err));
process.on("unhandledRejection", err => console.log("REJECTION:", err));

// ===== DATABASE =====
let db = { users: [] };
try {
    db = JSON.parse(fs.readFileSync("database.json"));
} catch {
    fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}
const saveDB = () => fs.writeFileSync("database.json", JSON.stringify(db, null, 2));

// ===== SESSION =====
let sessions = {};
const getSession = (id) => {
    if (!sessions[id]) sessions[id] = {};
    return sessions[id];
};

// ===== LOADER =====
async function runTask(chatId, text, task) {
    const msg = await bot.sendMessage(chatId, `⏳ ${text}...`);
    try {
        const res = await task();
        await bot.editMessageText(`✅ ${text} completed`, {
            chat_id: chatId,
            message_id: msg.message_id
        });
        return res;
    } catch (e) {
        await bot.editMessageText(`❌ ${text} failed`, {
            chat_id: chatId,
            message_id: msg.message_id
        });
        throw e;
    }
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
    const id = msg.chat.id;

    if (!db.users.includes(id)) {
        db.users.push(id);
        saveDB();
        bot.sendMessage(OWNER_ID, `👤 New User: ${id}`);
    }

    menu(id);
});

// ===== MENU =====
function menu(id) {
    bot.sendMessage(id, "🚀 DIE GITHUB MANAGER PRO", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📁 My Repos", callback_data: "repos" }],
                [{ text: "➕ Create Repo", callback_data: "create_repo" }],
                [{ text: "🔍 Search Repo", callback_data: "search_repo" }],
                [{ text: "🤖 AI Fix", callback_data: "ai" }]
            ]
        }
    });
}

// ===== UPDATE COMMAND =====
bot.onText(/\/update (.+)/, async (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    const text = match[1];
    let success = 0, fail = 0;

    const status = await bot.sendMessage(msg.chat.id, "🚀 Sending update...");

    for (let id of db.users) {
        try {
            await bot.sendMessage(id,
`🚀 *BOT UPDATED*

${text}

🔥 Enjoy new features!`,
            { parse_mode: "Markdown" }
            );
            success++;
        } catch {
            fail++;
        }
    }

    await bot.editMessageText(
        `📊 Done\n\n✅ ${success}\n❌ ${fail}`,
        {
            chat_id: msg.chat.id,
            message_id: status.message_id
        }
    );
});

// ===== CALLBACK =====
bot.on("callback_query", async (q) => {
    const id = q.message.chat.id;
    const data = q.data;
    const s = getSession(id);

    try {

        if (!s.token) {
            return bot.sendMessage(id, "🔑 Send GitHub token first");
        }

        if (data === "repos") {
            const res = await runTask(id, "Fetching repos", async () =>
                await axios.get("https://api.github.com/user/repos", {
                    headers: { Authorization: `Bearer ${s.token}` }
                })
            );

            let btn = res.data.map(r => ([{
                text: r.name,
                callback_data: "repo_" + encodeURIComponent(r.name)
            }]));

            return bot.sendMessage(id, "📂 Repos:", {
                reply_markup: { inline_keyboard: btn }
            });
        }

        if (data === "create_repo") {
            s.create = true;
            return bot.sendMessage(id, "Send repo name");
        }

        if (data === "search_repo") {
            s.search = true;
            return bot.sendMessage(id, "Send repo name");
        }

        if (data === "ai") {
            s.ai = true;
            return bot.sendMessage(id, "Send code to fix");
        }

        if (data.startsWith("repo_")) {
            s.repo = decodeURIComponent(data.split("_")[1]);

            const res = await runTask(id, "Loading files", async () =>
                await axios.get(
                    `https://api.github.com/repos/${s.username}/${s.repo}/contents`,
                    { headers: { Authorization: `Bearer ${s.token}` } }
                )
            );

            let files = res.data.map(f => ([{
                text: f.name,
                callback_data: "file_" + encodeURIComponent(f.path)
            }]));

            files.push([{ text: "📤 Upload File", callback_data: "upload_file" }]);

            return bot.sendMessage(id, "📂 Files:", {
                reply_markup: { inline_keyboard: files }
            });
        }

        if (data === "upload_file") {
            s.upload = true;
            return bot.sendMessage(id, "📤 Send file");
        }

    } catch (e) {
        bot.sendMessage(id, "❌ Error");
    }

    bot.answerCallbackQuery(q.id);
});

// ===== MESSAGE =====
bot.on("message", async (msg) => {
    const id = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    const s = getSession(id);

    try {

        if (!s.token) {
            const user = await runTask(id, "Login", async () =>
                await axios.get("https://api.github.com/user", {
                    headers: { Authorization: `Bearer ${text}` }
                })
            );

            s.token = text;
            s.username = user.data.login;

            return bot.sendMessage(id, "✅ Logged in");
        }

        if (s.create) {
            await runTask(id, "Creating repo", async () =>
                await axios.post(
                    "https://api.github.com/user/repos",
                    { name: text },
                    { headers: { Authorization: `Bearer ${s.token}` } }
                )
            );

            s.repo = text;

            return bot.sendMessage(id, `✅ Repo Created: ${text}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📤 Add Files", callback_data: "upload_file" }]
                    ]
                }
            });
        }

        if (s.search) {
            const res = await runTask(id, "Searching", async () =>
                await axios.get(`https://api.github.com/search/repositories?q=${text}`)
            );

            bot.sendMessage(id,
                res.data.items.slice(0, 5).map(r => r.full_name).join("\n")
            );
            s.search = false;
            return;
        }

        if (s.ai) {
            const res = await runTask(id, "AI Fix", async () =>
                await axios.post("https://api.openai.com/v1/chat/completions", {
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: text }]
                }, {
                    headers: { Authorization: `Bearer ${OPENAI_KEY}` }
                })
            );

            bot.sendMessage(id, res.data.choices[0].message.content);
            s.ai = false;
            return;
        }

    } catch {
        bot.sendMessage(id, "❌ Error");
    }
});

// ===== FILE UPLOAD =====
bot.on("document", async (msg) => {
    const id = msg.chat.id;
    const s = getSession(id);

    if (!s.repo) return bot.sendMessage(id, "❌ Select repo first");

    try {
        const link = await bot.getFileLink(msg.document.file_id);
        const file = await axios.get(link, { responseType: "arraybuffer" });

        await runTask(id, "Uploading", async () =>
            await axios.put(
                `https://api.github.com/repos/${s.username}/${s.repo}/contents/${msg.document.file_name}`,
                {
                    message: "upload",
                    content: Buffer.from(file.data).toString("base64")
                },
                { headers: { Authorization: `Bearer ${s.token}` } }
            )
        );

        bot.sendMessage(id, "✅ Uploaded");

    } catch {
        bot.sendMessage(id, "❌ Upload failed");
    }
});
