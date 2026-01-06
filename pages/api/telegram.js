const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SHEETDB_API = process.env.SHEETDB_API;

// In-memory state (Vercel serverless friendly for short flows)
const userState = new Map(); // chatId -> { step,sender }

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

const mainMenu = {
  keyboard: [
    ["🆕 New Send", "💰 Total Amount"],
    ["📋 All Submit"],
  ],
  resize_keyboard: true,
};

// ---------------- API HANDLER ----------------
export default async function handler(req, res) {
  // Health check
  if (req.method !== "POST") {
    return res.status(200).send("Bot is running");
  }

  const update = req.body;

  try {
    // ================= MESSAGE =================
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      // SAFE user object
      const from = update.message.from || {};
      const username =
        from.username ||
        from.first_name ||
        "NoUsername";

      // ---------- /start ----------
      if (text === "/start") {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "Welcome! Please select an action:",
          reply_markup: mainMenu,
        });
        return res.json({ ok: true });
      }

      const state = userState.get(chatId);

      // ---------- MENU ----------
      if (!state) {
        if (text === "🆕 New Send") {
          userState.set(chatId, { step: "USERNAME" });
          await tg("sendMessage", {
            chat_id: chatId,
            text: "Enter Sender Username (or type 'self'):",
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
            reply_markup: mainMenu,
          });
          return res.json({ ok: true });
        }
      }

      // ---------- USERNAME STEP ----------
      if (state?.step === "USERNAME") {
        let sender = text;

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

      // ---------- AMOUNT STEP ----------
      if (state?.step === "AMOUNT") {
        if (!/^\d+$/.test(text)) {
          await tg("sendMessage", {
            chat_id: chatId,
            text: "❌ Amount must be a number.",
          });
          return res.json({ ok: true });
        }

        const amount = Number(text);
        const dateId = new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14);

        // Save to SheetDB
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

        // Notify Admin
        await tg("sendMessage", {
          chat_id: ADMIN_ID,
          parse_mode: "HTML",
          text:
            `📩 <b>New Submission</b>\n\n` +
            `👤 <b>From:</b> @${username}\n` +
            `🛡 <b>Moderator:</b> ${state.moderator}\n` +
            `🔁 <b>Sender:</b> ${state.sender}\n` +
            `💰 <b>Amount:</b> ${amount}`,
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

        // Confirm User
        await tg("sendMessage", {
          chat_id: chatId,
          text: "✅ Submitted! Wait for admin approval.",
          reply_markup: mainMenu,
        });

        userState.delete(chatId);
        return res.json({ ok: true });
      }
    }

    // ================= CALLBACK =================
    if (update.callback_query) {
      const q = update.callback_query;
      const data = q.data;
      const chatId = q.message.chat.id;

      // Admin action
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
          text: `Submission ${status} ${
            status === "accepted" ? "✅" : "❌"
          }`,
        });

        await tg("sendMessage", {
          chat_id: Number(targetChat),
          text: `📢 Submission ${status.toUpperCase()}`,
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
