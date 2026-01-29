import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const WATI_TOKEN = process.env.WATI_TOKEN;
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const BOTPRESS_URL = process.env.BOTPRESS_URL;

// ===== HEALTH =====
app.get("/health", (req, res) => {
  res.send("OK");
});

// ===== WATI -> BOT =====
app.post("/wati", async (req, res) => {
  try {
    const phone =
      req.body?.waId ||
      req.body?.whatsappNumber ||
      req.body?.data?.waId;

    const text =
      req.body?.text ||
      req.body?.message?.text ||
      req.body?.data?.text;

    if (!phone || !text) {
      return res.sendStatus(200);
    }

    const conversationId = `wati-${phone}`;

    await fetch(BOTPRESS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId,
        type: "text",
        text
      })
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("WATI->BOT error:", error);
    res.sendStatus(200);
  }
});

// ===== BOT -> WATI =====
app.post("/botpress", async (req, res) => {
  try {
    const conversationId = req.body?.conversationId;
    const text =
      req.body?.payload?.text ||
      req.body?.text;

    if (!conversationId || !text) {
      return res.sendStatus(200);
    }

    const phone = conversationId.replace("wati-", "");

    const url = `https://app.wati.io/${WATI_TENANT_ID}/api/v1/sendSessionMessage/${phone}`;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: WATI_TOKEN
      },
      body: JSON.stringify({
        messageText: text
      })
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("BOT->WATI error:", error);
    res.sendStatus(200);
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
