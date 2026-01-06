const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SHEETDB_API = process.env.SHEETDB_API;

// In-memory state
const userState = new Map(); // chatId -> { step, sender }

// ---------------- HELPERS ----------------
const tg = async (method, body) => {
    const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
    return res.json();
};

const isValidUsername = (u) => /^@?[a-zA-Z0-9_]{5,32}$/.test(u);

// const mainMenu = {
//     keyboard: [
//         ["🆕 New Send", "💰 Total Amount"],
//         ["📋 All Submit"],
//     ],
//     resize_keyboard: true,
// };

// ---------- MENUS ----------
const mainMenuUser = {
    keyboard: [
        ["🆕 New Send", "💰 Total Amount"],
        ["📋 All Submit"],
    ],
    resize_keyboard: true,
};

const mainMenuAdmin = {
    keyboard: [
        ["📋 All Submissions", "📊 Total Info"],
        ["🔄 Refresh Data"],
    ],
    resize_keyboard: true,
};


// ---------------- API HANDLER ----------------
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(200).send("Bot is running");
    }

    const update = req.body;

    try {
        // ================= MESSAGE =================
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || "";
            const from = update.message.from || {};
            const username = from.username || from.first_name || "NoUsername";

            // ---------- /start ----------
            if (text === "/start") {
                const menu = chatId === ADMIN_ID ? mainMenuAdmin : mainMenuUser;

                await tg("sendMessage", {
                    chat_id: chatId,
                    text: "Welcome! Please select an action:",
                    reply_markup: menu,
                });
                return res.json({ ok: true });
            }


            const state = userState.get(chatId);

            // ---------- MENU ----------
            if (!state) {
                if (chatId === ADMIN_ID) {
                    // ----- ADMIN MENU -----
                    if (chatId === ADMIN_ID && text === "📋 All Submissions") {
                        const data = await fetch(SHEETDB_API).then(r => r.json());

                        if (!data.length) {
                            await tg("sendMessage", {
                                chat_id: ADMIN_ID,
                                text: "No submissions found",
                                reply_markup: mainMenuAdmin
                            });
                            return res.json({ ok: true });
                        }

                        // group by username
                        const byUser = {};
                        data.forEach(i => {
                            if (!byUser[i.telegram_user]) byUser[i.telegram_user] = [];
                            byUser[i.telegram_user].push(i);
                        });

                        for (const user in byUser) {
                            await tg("sendMessage", {
                                chat_id: ADMIN_ID,
                                text: `👤 USER: @${user}`
                            });

                            // group by date
                            const byDate = {};
                            byUser[user].forEach(i => {
                                const d = i.date.slice(0, 8);
                                if (!byDate[d]) byDate[d] = [];
                                byDate[d].push(i);
                            });

                            for (const date in byDate) {
                                await tg("sendMessage", {
                                    chat_id: ADMIN_ID,
                                    text: `📅 Date: ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
                                });

                                for (const i of byDate[date]) {

                                    let buttons = [];

                                    if (i.status === "pending") {
                                        buttons = [[
                                            { text: "✅ Accept", callback_data: `accept:${i.date}:${i.chat_id}` },
                                            { text: "❌ Cancel", callback_data: `cancel:${i.date}:${i.chat_id}` }
                                        ]];
                                    }

                                    if (i.status === "accepted") {
                                        buttons = [[
                                            { text: "💸 Paid", callback_data: `paid:${i.date}:${i.chat_id}` }
                                        ]];
                                    }

                                    // canceled / paid → no button

                                    await tg("sendMessage", {
                                        chat_id: ADMIN_ID,
                                        parse_mode: "HTML",
                                        text:
                                            `🔁 <b>Sender:</b> ${i.sender_username}\n` +
                                            `💰 <b>Amount:</b> ${i.amount}\n` +
                                            `📌 <b>Status:</b> ${i.status.toUpperCase()}`,
                                        reply_markup: buttons.length
                                            ? { inline_keyboard: buttons }
                                            : undefined
                                    });
                                }
                            }
                        }

                        return res.json({ ok: true });
                    }


                    if (chatId === ADMIN_ID && text === "📊 Total Info") {
                        const data = await fetch(SHEETDB_API).then(r => r.json());

                        if (!data.length) {
                            await tg("sendMessage", {
                                chat_id: ADMIN_ID,
                                text: "No data found"
                            });
                            return res.json({ ok: true });
                        }

                        // counters
                        const userStats = {};
                        let totalAccepted = 0;
                        let totalCanceled = 0;
                        let totalPaid = 0;

                        data.forEach(i => {
                            const user = i.telegram_user || "unknown";

                            if (!userStats[user]) {
                                userStats[user] = {
                                    accepted: 0,
                                    canceled: 0,
                                    paid: 0
                                };
                            }

                            if (i.status === "accepted") {
                                userStats[user].accepted++;
                                totalAccepted++;
                            }

                            if (i.status === "canceled") {
                                userStats[user].canceled++;
                                totalCanceled++;
                            }

                            if (i.status === "paid") {
                                userStats[user].paid++;
                                totalPaid++;
                            }
                        });

                        // per user message
                        for (const user in userStats) {
                            const s = userStats[user];

                            await tg("sendMessage", {
                                chat_id: ADMIN_ID,
                                text:
                                    `👤 @${user}\n` +
                                    `✅ Accepted: ${s.accepted}\n` +
                                    `❌ Canceled: ${s.canceled}\n` +
                                    `💸 Paid: ${s.paid}`
                            });
                        }

                        // grand total
                        await tg("sendMessage", {
                            chat_id: ADMIN_ID,
                            text:
                                `📦 GRAND TOTAL\n\n` +
                                `✅ Accepted: ${totalAccepted}\n` +
                                `❌ Canceled: ${totalCanceled}\n` +
                                `💸 Paid: ${totalPaid}`
                        });

                        return res.json({ ok: true });
                    }


                    if (text === "🔄 Refresh Data") {
                        await tg("sendMessage", {
                            chat_id: ADMIN_ID,
                            text: "✅ Data refreshed.",
                            reply_markup: mainMenuAdmin,
                        });
                        return res.json({ ok: true });
                    }
                } else {
                    // ----- NORMAL USER MENU -----
                    if (text === "🆕 New Send") {
                        userState.set(chatId, { step: "USERNAME" });

                        // Show a keyboard with "self" as a button
                        await tg("sendMessage", {
                            chat_id: chatId,
                            text: "Enter Sender Username or click 'self':",
                            reply_markup: {
                                keyboard: [
                                    ["self"], // clickable button
                                ],
                                one_time_keyboard: true, // keyboard disappears after click
                                resize_keyboard: true,
                            },
                        });
                        return res.json({ ok: true });
                    }

                    if (text === "💰 Total Amount") {
                        const data = await fetch(SHEETDB_API).then((r) => r.json());
                        const total = data
                            .filter(
                                (i) =>
                                    i.telegram_user === username &&
                                    i.status === "accepted"
                            )
                            .reduce((s, i) => s + Number(i.amount || 0), 0);

                        await tg("sendMessage", {
                            chat_id: chatId,
                            text: `💰 Your Approved Total: ${total}`,
                            reply_markup: mainMenuUser,
                        });
                        return res.json({ ok: true });
                    }

                    if (text === "📋 All Submit") {
                        const data = await fetch(SHEETDB_API).then((r) => r.json());
                        const myData = data.filter((i) => i.telegram_user === username);

                        if (myData.length === 0) {
                            await tg("sendMessage", {
                                chat_id: chatId,
                                text: "📋 No submissions found.",
                                reply_markup: mainMenuUser,
                            });
                            return res.json({ ok: true });
                        }

                        // unique dates (YYYYMMDD)
                        const dates = [...new Set(myData.map((i) => i.date?.slice(0, 8)))].sort().reverse();

                        const inline_keyboard = [];
                        for (let i = 0; i < dates.length; i += 2) {
                            const row = [];
                            for (let d of dates.slice(i, i + 2)) {
                                row.push({
                                    text: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
                                    callback_data: `view_date:${d}`,
                                });
                            }
                            inline_keyboard.push(row);
                        }

                        await tg("sendMessage", {
                            chat_id: chatId,
                            text: "📅 Select a date:",
                            reply_markup: { inline_keyboard },
                        });

                        return res.json({ ok: true });
                    }
                }
            }


            // ---------- USERNAME ----------
            if (state?.step === "USERNAME") {
                let sender = text.trim();

                if (text.toLowerCase() === "self") {
                    if (!from.username) {
                        await tg("sendMessage", {
                            chat_id: chatId,
                            text: "❌ You don't have a Telegram username.",
                        });
                        return res.json({ ok: true });
                    }
                    sender = "@" + from.username;
                }

                if (!isValidUsername(sender)) {
                    await tg("sendMessage", {
                        chat_id: chatId,
                        text: "❌ Invalid username format.",
                    });
                    return res.json({ ok: true });
                }

                if (!sender.startsWith("@")) sender = "@" + sender;

                state.sender = sender;
                state.step = "AMOUNT";

                await tg("sendMessage", {
                    chat_id: chatId,
                    text: `✅ Sender saved: ${sender}\nNow enter amount:`,
                });
                return res.json({ ok: true });
            }

            // ---------- AMOUNT ----------
            if (state?.step === "AMOUNT") {
                if (!/^\d+$/.test(text)) {
                    await tg("sendMessage", {
                        chat_id: chatId,
                        text: "❌ Amount must be a number.",
                    });
                    return res.json({ ok: true });
                }

                const amount = Number(text);
                const dateId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

                // Save to SheetDB
                await fetch(SHEETDB_API, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        data: [
                            {
                                date: dateId,
                                telegram_user: username,
                                chat_id: chatId,
                                sender_username: state.sender,
                                amount,
                                status: "pending",
                            },
                        ],
                    }),
                });

                // Notify Admin
                await tg("sendMessage", {
                    chat_id: ADMIN_ID,
                    parse_mode: "HTML",
                    text:
                        `📩 <b>New Submission</b>\n\n` +
                        `👤 <b>From:</b> @${username}\n` +
                        `🔁 <b>Sender:</b> ${state.sender}\n` +
                        `💰 <b>Amount:</b> ${amount}\n\n` + 
                        `<code>@${username} | ${amount}</code>`,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Accept", callback_data: `accept:${dateId}:${chatId}` },
                                { text: "❌ Cancel", callback_data: `cancel:${dateId}:${chatId}` },
                            ],
                        ],
                    },
                });

                await tg("sendMessage", {
                    chat_id: chatId,
                    text: "✅ Submitted! Wait for admin approval.",
                    reply_markup: mainMenuUser,
                });

                userState.delete(chatId);
                return res.json({ ok: true });
            }
        }

        // ================= CALLBACK =================
        if (update.callback_query) {
            const q = update.callback_query;
            const chatId = q.message.chat.id;
            const from = q.from || {};
            const username = from.username || from.first_name || "NoUsername";
            const data = q.data;

            // ---------- ACCEPT / CANCEL ----------
            // if (data.startsWith("accept") || data.startsWith("cancel")) {
            //     const [action, date, targetChat] = data.split(":");
            //     const status = action === "accept" ? "accepted" : "canceled";

            //     await fetch(`${SHEETDB_API}/date/${date}`, {
            //         method: "PATCH",
            //         headers: { "Content-Type": "application/json" },
            //         body: JSON.stringify({ data: [{ status }] }),
            //     });

            //     await tg("editMessageText", {
            //         chat_id: chatId,
            //         message_id: q.message.message_id,
            //         text: `Submission ${status} ${status === "accepted" ? "✅" : "❌"}`,
            //     });

            //     await tg("sendMessage", {
            //         chat_id: Number(targetChat),
            //         text: `📢 Submission ${status.toUpperCase()}`,
            //     });

            //     return res.json({ ok: true });
            // }

            if (data.startsWith("accept") || data.startsWith("cancel") || data.startsWith("paid")) {

                const [action, dateId, targetChat] = data.split(":");

                let status = "";
                let userMsg = "";

                if (action === "accept") {
                    status = "accepted";
                    userMsg = "✅ Your submission has been ACCEPTED";
                }

                if (action === "cancel") {
                    status = "canceled";
                    userMsg = "❌ Your submission has been CANCELED";
                }

                if (action === "paid") {
                    status = "paid";
                    userMsg = "💸 Your payment has been MARKED AS PAID";
                }

                // 1️⃣ Update SheetDB
                await fetch(`${SHEETDB_API}/date/${dateId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: [{ status }] })
                });

                // 2️⃣ Update admin message
                await tg("editMessageText", {
                    chat_id: chatId,
                    message_id: q.message.message_id,
                    text: `Status updated: ${status.toUpperCase()}`
                });

                // 3️⃣ Notify user (🔥 THIS WAS MISSING 🔥)
                await tg("sendMessage", {
                    chat_id: Number(targetChat),
                    text: userMsg
                });

                return res.json({ ok: true });
            }





            // ---------- VIEW DATE ----------
            if (data.startsWith("view_date:")) {
                const selectedDate = data.split(":")[1];
                const allData = await fetch(SHEETDB_API).then((r) => r.json());

                const myData = allData.filter(
                    (i) => i.telegram_user === username && i.date?.startsWith(selectedDate)
                );

                if (myData.length === 0) {
                    await tg("editMessageText", {
                        chat_id: chatId,
                        message_id: q.message.message_id,
                        text: "❌ No data found for this date.",
                    });
                    return res.json({ ok: true });
                }

                let msg = `📋 <b>Submissions for ${selectedDate.slice(0, 4)}-${selectedDate.slice(4, 6)}-${selectedDate.slice(6, 8)}</b>\n\n`;
                let dayTotal = 0;

                myData.forEach((i) => {
                    const icon = i.status === "accepted" ? "✅" : i.status === "pending" ? "⏳" : "❌";
                    msg += `${icon} ${i.amount} | ${i.sender_username}\n`;
                    if (i.status === "accepted") dayTotal += Number(i.amount || 0);
                });

                msg += `\n━━━━━━━━━━━━━━\n💰 <b>Daily Total:</b> ${dayTotal}`;

                await tg("editMessageText", {
                    chat_id: chatId,
                    message_id: q.message.message_id,
                    text: msg,
                    parse_mode: "HTML",
                });

                return res.json({ ok: true });
            }

            if (data.startsWith("paid:") && chatId === ADMIN_ID) {
                const [, date] = data.split(":");

                await fetch(`${SHEETDB_API}/date/${date}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: [{ status: "paid" }] }),
                });

                await tg("editMessageText", {
                    chat_id: chatId,
                    message_id: q.message.message_id,
                    parse_mode: "HTML",
                    text: q.message.text.replace(/Status:.*/i, "📌 Status: PAID"),
                });

                return res.json({ ok: true });
            }

        }

        return res.json({ ok: true });
    } catch (err) {
        console.error("BOT ERROR:", err);
        return res.status(200).json({ ok: true });
    }
}
