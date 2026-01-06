const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SHEETDB_API = process.env.SHEETDB_API;

const userState = new Map(); // chatId -> state data

// ---------------- HELPERS ----------------
const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const isValidUsername = (u) => /^@?[a-zA-Z0-9_]{5,32}$/.test(u);

const mainMenu = {
  keyboard: [
    ["🆕 New Send", "💰 Total Amount"],
    ["📋 All Submit"],
  ],
  resize_keyboard: true,
};

const moderators = ["Millat", "Shifat", "Mahin", "Nirob"];

const moderatorKeyboard = {
  inline_keyboard: moderators.reduce((acc, m, i) => {
    if (i % 2 === 0) acc.push([]);
    acc[acc.length - 1].push({ text: m, callback_data: `set_mod:${m}` });
    return acc;
  }, []),
};

// ---------------- API HANDLER ----------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Bot Running");

  const update = req.body;

  // ---------- MESSAGE ----------
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;
    const username =
      update.message.from_user.username ||
      update.message.from_user.first_name;

    // /start
    if (text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "Welcome! Please select an action:",
        reply_markup: mainMenu,
      });
      return res.json({ ok: true });
    }

    const state = userState.get(chatId);

    // ---- MENU ----
    if (!state) {
      if (text === "🆕 New Send") {
        userState.set(chatId, { step: "MODERATOR" });
        await tg("sendMessage", {
          chat_id: chatId,
          text: "📋 Select a Moderator:",
          reply_markup: moderatorKeyboard,
        });
      }

      if (text === "💰 Total Amount") {
        const data = await fetch(SHEETDB_API).then((r) => r.json());
        const total = data
          .filter(
            (i) =>
              i.telegram_user === username && i.status === "accepted"
          )
          .reduce((s, i) => s + Number(i.amount || 0), 0);

        await tg("sendMessage", {
          chat_id: chatId,
          text: `💰 Your Approved Total: ${total}`,
          reply_markup: mainMenu,
        });
      }
    }

    // ---- USERNAME ----
    if (state?.step === "USERNAME") {
      let sender = text;

      if (text.toLowerCase() === "self") {
        if (!update.message.from_user.username) {
          await tg("sendMessage", {
            chat_id: chatId,
            text: "❌ You don't have a Telegram username.",
          });
          return res.json({ ok: true });
        }
        sender = "@" + update.message.from_user.username;
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
    }

    // ---- AMOUNT ----
    if (state?.step === "AMOUNT") {
      if (!/^\d+$/.test(text)) {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "❌ Amount must be number.",
        });
        return res.json({ ok: true });
      }

      const amount = Number(text);
      const dateId = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14);

      await fetch(SHEETDB_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            {
              date: dateId,
              moderator: state.moderator,
              telegram_user: username,
              chat_id: chatId,
              sender_username: state.sender,
              amount,
              status: "pending",
            },
          ],
        }),
      });

      await tg("sendMessage", {
        chat_id: ADMIN_ID,
        text:
          `📩 <b>New Submission</b>\n\n` +
          `👤 <b>From:</b> @${username}\n` +
          `🛡 <b>Moderator:</b> ${state.moderator}\n` +
          `🔁 <b>Sender:</b> ${state.sender}\n` +
          `💰 <b>Amount:</b> ${amount}`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Accept",
                callback_data: `accept:${dateId}:${chatId}`,
              },
              {
                text: "❌ Cancel",
                callback_data: `cancel:${dateId}:${chatId}`,
              },
            ],
          ],
        },
      });

      await tg("sendMessage", {
        chat_id: chatId,
        text: "✅ Submitted! Wait for admin approval.",
        reply_markup: mainMenu,
      });

      userState.delete(chatId);
    }
  }

  // ---------- CALLBACK ----------
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message.chat.id;
    const data = q.data;

    // MODERATOR SELECT
    if (data.startsWith("set_mod:")) {
      const mod = data.split(":")[1];
      userState.set(chatId, { step: "USERNAME", moderator: mod });

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: `✅ Moderator: ${mod}\n\nNow enter Sender Username (or type 'self'):`,
      });
    }

    // ADMIN ACTION
    if (data.startsWith("accept") || data.startsWith("cancel")) {
      const [action, date, targetChat] = data.split(":");
      const status = action === "accept" ? "accepted" : "canceled";

      await fetch(`${SHEETDB_API}/date/${date}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [{ status }] }),
      });

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: q.message.message_id,
        text: `Submission ${status} ${status === "accepted" ? "✅" : "❌"}`,
      });

      await tg("sendMessage", {
        chat_id: Number(targetChat),
        text: `📢 Submission ${status.toUpperCase()}`,
      });
    }
  }

  res.json({ ok: true });
}
