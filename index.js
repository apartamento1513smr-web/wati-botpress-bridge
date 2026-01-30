import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL; // cualquier URL que contenga el UUID del webhook
const BOTPRESS_API_KEY = process.env.BOTPRESS_API_KEY; // opcional (si la tienes)
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const WATI_TOKEN = process.env.WATI_TOKEN;

// Safety checks
if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// 1) Extraer el UUID real del webhook desde BOTPRESS_URL (evita que quede "webhook")
const uuidRegex =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const match = BOTPRESS_URL.match(uuidRegex);
if (!match) {
  throw new Error(
    `BOTPRESS_URL does not contain a valid webhook UUID. Value was: ${BOTPRESS_URL}`
  );
}

const WEBHOOK_ID = match[0];

// 2) Base correcta del Chat API webhook
const BP_CHAT_BASE = `https://chat.botpress.cloud/webhook/${WEBHOOK_ID}`;

// Headers opcionales para Botpress (si tienes API KEY)
const botpressHeaders = {
  "Content-Type": "application/json",
  ...(BOTPRESS_API_KEY ? { "x-botpress-api-key": BOTPRESS_API_KEY } : {})
};

// Health check
app.get("/health", (req, res) => res.send("OK"));

// Util: enviar a WATI
async function sendToWati(phone, messageText) {
  const url = `https://live-mt-server.wati.io/${WATI_TENANT_ID}/api/v1/sendSessionMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WATI_TOKEN, // normalmente viene como "Bearer xxxx"
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ whatsappNumber: phone, messageText })
  });

  const txt = await r.text();
  console.log("WATI send:", r.status, txt);
  return { status: r.status, body: txt };
}

// Recibir desde WATI
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
      console.log("Invalid payload from WATI:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From WATI:", phone, "text:", text);

    // 1) get-or-create conversation
    const convRes = await fetch(`${BP_CHAT_BASE}/conversations/get-or-create`, {
      method: "POST",
      headers: botpressHeaders,
      body: JSON.stringify({ id: String(phone) })
    });

    const convText = await convRes.text();
    let convJson = null;
    try { convJson = JSON.parse(convText); } catch {}

    if (!convRes.ok) {
      console.log("Botpress conv error:", convRes.status, convText);
      await sendToWati(phone, "Estoy presentando un problema técnico. Intenta de nuevo en un momento 🙏");
      return res.sendStatus(200);
    }

    const conversationId =
      convJson?.conversation?.id ||
      convJson?.id ||
      String(phone);

    // 2) send message to botpress
    const msgRes = await fetch(`${BP_CHAT_BASE}/messages`, {
      method: "POST",
      headers: botpressHeaders,
      body: JSON.stringify({
        conversationId,
        payload: { type: "text", text }
      })
    });

    const msgText = await msgRes.text();
    let msgJson = null;
    try { msgJson = JSON.parse(msgText); } catch {}

    console.log("Botpress status:", msgRes.status);
    if (!msgRes.ok) {
      console.log("Botpress message error:", msgRes.status, msgText);
      await sendToWati(phone, "Estoy presentando un problema técnico. Intenta de nuevo en un momento 🙏");
      return res.sendStatus(200);
    }

    // Botpress a veces contesta async por /botpress, así que aquí NO forzamos reply
    res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    res.sendStatus(500);
  }
});

// Recibir respuesta desde Botpress (Messaging API Response Endpoint URL)
app.post("/botpress", async (req, res) => {
  try {
    const conversationId = req.body?.conversationId || req.body?.conversation?.id;
    const text =
      req.body?.payload?.text ||
      req.body?.payload?.message ||
      req.body?.payload?.content;

    if (!conversationId || !text) return res.sendStatus(200);

    await sendToWati(String(conversationId), String(text));
    res.sendStatus(200);
  } catch (err) {
    console.error("Botpress->WATI error:", err);
    res.sendStatus(500);
    console.log("Incoming /botpress:", JSON.stringify(req.body));
  }
});

app.listen(PORT, () => console.log("Server running on port", PORT));



