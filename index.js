import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL;      // puede venir como https://webhook.botpress.cloud/<id>
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;  // número tenant (ej: 1085564)
const WATI_TOKEN = process.env.WATI_TOKEN;          // ideal: "Bearer eyJ..." (tal cual te lo da WATI)

// Safety checks
if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// ---- Botpress Chat API base (para ENVIAR mensajes al bot) ----
// Chat API usa https://chat.botpress.cloud/{webhookUrl}/messages :contentReference[oaicite:1]{index=1}
function getBotpressBaseUrl() {
  const parts = String(BOTPRESS_URL).split("/").filter(Boolean);
  const webhookId = parts[parts.length - 1]; // el UUID final
  return `https://chat.botpress.cloud/${webhookId}`;
}

const BP_BASE = getBotpressBaseUrl();

// cache simple (en Render free se puede reiniciar, no pasa nada)
const conversationCache = new Map(); // phone -> conversationId

async function getOrCreateConversation(phone) {
  if (conversationCache.has(phone)) return conversationCache.get(phone);

  // 1) getOrCreateUser
  // Endpoint de Chat API (docs): getOrCreateUser :contentReference[oaicite:2]{index=2}
  await fetch(`${BP_BASE}/users/get-or-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-key": phone
    },
    body: JSON.stringify({}) // no necesita nada para “get-or-create”
  });

  // 2) getOrCreateConversation
  // Endpoint de Chat API: getOrCreateConversation :contentReference[oaicite:3]{index=3}
  const convRes = await fetch(`${BP_BASE}/conversations/get-or-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-key": phone
    },
    body: JSON.stringify({})
  });

  const convData = await convRes.json();
  const conversationId =
    convData?.conversation?.id ||
    convData?.conversationId ||
    convData?.id;

  if (!conversationId) {
    throw new Error("Could not get conversationId from Botpress");
  }

  conversationCache.set(phone, conversationId);
  return conversationId;
}

async function sendToBotpress(phone, text) {
  const conversationId = await getOrCreateConversation(phone);

  // createMessage (Chat API): POST https://chat.botpress.cloud/{webhookUrl}/messages :contentReference[oaicite:4]{index=4}
  const resp = await fetch(`${BP_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-key": phone
    },
    body: JSON.stringify({
      conversationId,
      payload: {
        type: "text",
        text
      }
    })
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Botpress createMessage failed: ${resp.status} ${t}`);
  }
}

// ---- WATI sender ----
async function sendToWati(phone, messageText) {
  const text = (messageText ?? "").toString().trim();
  if (!text) {
    console.log("Skipping WATI send: empty messageText");
    return;
  }

  const watiRes = await fetch(
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

  const watiData = await watiRes.json().catch(() => null);
  console.log("WATI send:", watiRes.status, watiData || "(no json)");
}

// Health check
app.get("/health", (req, res) => res.send("OK"));

// 1) Receive from WATI -> send to Botpress (NO respondemos a WATI aquí)
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

    await sendToBotpress(phone, text);

    return res.sendStatus(200);
  } catch (err) {
    console.error("WATI -> Botpress error:", err);
    return res.sendStatus(500);
  }
});

// 2) Receive from Botpress -> send to WATI (AQUÍ sí enviamos la respuesta al cliente)
app.post("/botpress", async (req, res) => {
  try {
    const phone = req.body?.conversationId;
    const text = req.body?.payload?.text;

    if (!phone || !text) {
      console.log("Invalid payload from Botpress:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From Botpress:", phone, "text:", text);

    await sendToWati(phone, text);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Botpress -> WATI error:", err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
  console.log("Botpress base:", BP_BASE);
});
