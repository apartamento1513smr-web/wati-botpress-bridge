import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const WATI_TOKEN = process.env.WATI_TOKEN;
const BOTPRESS_BOT_ID = process.env.BOTPRESS_BOT_ID;
const BOTPRESS_API_KEY = process.env.BOTPRESS_API_KEY;

if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");
if (!BOTPRESS_BOT_ID) throw new Error("Missing BOTPRESS_BOT_ID");
if (!BOTPRESS_API_KEY) throw new Error("Missing BOTPRESS_API_KEY");

app.get("/health", (req, res) => {
  res.send("OK");
});

// WATI → BOT
app.post("/wati", async (req, res) => {
  try {
    const text =
      req.body?.message?.text ||
      req.body?.text ||
      req.body?.message?.body;

    const phone =
      req.body?.waId ||
      req.body?.whatsappNumber ||
      req.body?.contact?.waId;

    if (!text || !phone) {
      console.log("Invalid payload from WATI:", req.body);
      return res.sendStatus(200);
    }

    console.log("From WATI:", phone, text);

    const botpressRes = await fetch(
      "https://api.botpress.cloud/v1/chat/send",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${BOTPRESS_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          botId: BOTPRESS_BOT_ID,
          conversationId: phone,
          message: {
            type: "text",
            text: text
          }
        })
      }
    );

    const data = await botpressRes.json();

    const reply =
      data?.messages?.[0]?.payload?.text ||
      "Gracias por tu mensaje 😊";

    await fetch(
      `https://live-mt-server.wati.io/${WATI_TENANT_ID}/api/v1/sendSessionMessage`,
      {
        method: "POST",
        headers: {
          Authorization: WATI_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          whatsappNumber: phone,
          messageText: reply
        })
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
