import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const WATI_TOKEN = process.env.WATI_TOKEN;
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const BOTPRESS_URL = process.env.BOTPRESS_URL;
const BOTPRESS_TOKEN = process.env.BOTPRESS_TOKEN;
const BOTPRESS_BOT_ID = process.env.BOTPRESS_BOT_ID;

// Mapa simple de sesiones
const sessions = new Map();

// Health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// WATI -> BOT
app.post("/wati", async (req, res) => {
  try {
    const phone = req.body?.waId || req.body?.whatsappNumber;
    const text = req.body?.text || req.body?.message?.text;

    if (!phone || !text) return res.sendStatus(200);

    const conversationId = `wati-${phone}`;
    sessions.set(conversationId, phone);

    await fetch(`${BOTPRESS_URL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BOTPRESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        botId: BOTPRESS_BOT_ID,
        conversationId,
        type: "text",
        text
      })
    });

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(200);
  }
});

// BOT -> WATI
app.post("/botpress", async (req, res) => {
  try {
    const conversationId = req.body?.conversationId;
    const text = req.body?.payload?.text || req.body?.text;

    const phone = sessions.get(conversationId);
    if (!phone || !text) return res.sendStatus(200);

    const url = `https://app.wati.io/${WATI_TENANT_ID}/api/v1/sendSessionMessage/${phone}`;

    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WATI_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messageText: text })
    });

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
