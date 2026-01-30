import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL;            // tu webhook de Botpress (Messaging API) o endpoint que uses
const WATI_API_ENDPOINT = process.env.WATI_API_ENDPOINT; // EJ: https://live-mt-server.wati.io/1085564
const WATI_TOKEN = process.env.WATI_TOKEN;               // EJ: Bearer eyJ...

if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!WATI_API_ENDPOINT) throw new Error("Missing WATI_API_ENDPOINT");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

app.get("/health", (req, res) => res.send("OK"));
app.get("/", (req, res) => res.send("OK"));

async function sendToWati(whatsappNumber, messageText) {
  const url = `${WATI_API_ENDPOINT}/api/v1/sendSessionMessage`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WATI_TOKEN,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      whatsappNumber,
      messageText,
    }),
  });

  const bodyText = await r.text();
  console.log("WATI send:", r.status, bodyText);
  return { status: r.status, bodyText };
}

// Webhook desde WATI -> Botpress
app.post("/wati", async (req, res) => {
  try {
    // intenta leer texto y número en varios formatos posibles
    const text =
      req.body?.message?.text ||
      req.body?.text ||
      req.body?.message?.body ||
      req.body?.messageText;

    const phone =
      req.body?.waId ||
      req.body?.whatsappNumber ||
      req.body?.contact?.waId ||
      req.body?.contact?.whatsappNumber;

    if (!text || !phone) {
      console.log("Invalid payload from WATI:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From WATI:", phone, "text:", text);

    const botpressRes = await fetch(BOTPRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: phone,
        type: "text",
        text,
      }),
    });

    const botpressText = await botpressRes.text();
    console.log("Botpress status:", botpressRes.status);
    console.log("Botpress response:", botpressText);

    let reply = "Gracias por tu mensaje 😊";
    try {
      const data = JSON.parse(botpressText);
      reply =
        data?.responses?.find(r => r?.payload?.text)?.payload?.text ||
        data?.payload?.text ||
        reply;
    } catch {}

    await sendToWati(phone, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    res.sendStatus(500);
  }
});

// Entrada manual desde Botpress -> WATI
app.post("/botpress", async (req, res) => {
  try {
    const phone = req.body?.conversationId;
    const text = req.body?.payload?.text;

    if (!phone || !text) return res.sendStatus(200);

    console.log("From Botpress:", phone, "text:", text);
    await sendToWati(phone, text);

    res.sendStatus(200);
  } catch (err) {
    console.error("Botpress->WATI error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log("Server running on port", PORT));

