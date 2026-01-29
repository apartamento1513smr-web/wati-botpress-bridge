import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL;
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const WATI_TOKEN = process.env.WATI_TOKEN;

// Safety checks
if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// Health check
app.get("/health", (req, res) => {
  res.send("OK");
});

// Receive from WATI
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

    const botpressRes = await fetch(BOTPRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: phone,
        type: "text",
        text: text
      })
    });

    const data = await botpressRes.json();

    const reply =
      data?.responses?.[0]?.payload?.text ||
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

// Receive from Botpress
app.post("/botpress", async (req, res) => {
  try {
    const phone = req.body.conversationId;
    const text = req.body.payload?.text;

    if (!phone || !text) return res.sendStatus(200);

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
          messageText: text
        })
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("Botpress->WATI error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
