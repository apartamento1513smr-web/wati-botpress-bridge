import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_API_KEY = process.env.BOTPRESS_API_KEY;
const BOTPRESS_BOT_ID = process.env.BOTPRESS_BOT_ID;

const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const WATI_TOKEN = process.env.WATI_TOKEN;
const WATI_API_ENDPOINT = process.env.WATI_API_ENDPOINT || "live-mt-server.wati.io";

// -------- Safety checks --------
if (!BOTPRESS_API_KEY) throw new Error("Missing BOTPRESS_API_KEY");
if (!BOTPRESS_BOT_ID) throw new Error("Missing BOTPRESS_BOT_ID");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// -------- Helpers --------
function normalizeWatiText(body) {
  // WATI puede mandar diferentes formas
  return (
    body?.message?.text ||
    body?.text ||
    body?.message?.body ||
    body?.data?.message?.text ||
    body?.data?.text ||
    ""
  );
}

function normalizeWatiPhone(body) {
  return (
    body?.waId ||
    body?.whatsappNumber ||
    body?.contact?.waId ||
    body?.data?.waId ||
    body?.data?.whatsappNumber ||
    ""
  );
}

async function sendToWati(phone, text) {
  const messageText = (text || "").trim();
  if (!messageText) {
    console.log("WATI: not sending empty message");
    return { skipped: true };
  }

  const url = `https://${WATI_API_ENDPOINT}/${WATI_TENANT_ID}/api/v1/sendSessionMessage`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WATI_TOKEN, // debe incluir "Bearer ..."
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      whatsappNumber: phone,
      messageText,
    }),
  });

  const data = await r.json().catch(() => ({}));
  console.log("WATI send:", r.status, data);
  return { status: r.status, data };
}

async function sendToBotpress(phone, text) {
  // API oficial de Botpress Cloud
  const url = "https://api.botpress.cloud/v1/chat/send";

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BOTPRESS_API_KEY}`,
      "x-bot-id": BOTPRESS_BOT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: phone,
      type: "text",
      text,
    }),
  });

  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function extractBotpressReply(botpressData) {
  // Intentamos varias rutas porque Botpress puede responder distinto
  const candidates = [
    botpressData?.responses?.[0]?.payload?.text,
    botpressData?.messages?.find((m) => m?.type === "text")?.text,
    botpressData?.message?.text,
    botpressData?.payload?.text,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

// -------- Routes --------
app.get("/health", (req, res) => res.send("OK"));

/**
 * Webhook de WATI -> Botpress -> WATI
 */
app.post("/wati", async (req, res) => {
  try {
    const text = normalizeWatiText(req.body).trim();
    const phone = normalizeWatiPhone(req.body).trim();

    if (!text || !phone) {
      console.log("Invalid payload from WATI:", JSON.stringify(req.body));
      return res.sendStatus(200); // WATI espera 200
    }

    console.log("From WATI:", phone, "text:", text);

    const botpressRes = await sendToBotpress(phone, text);
    console.log("Botpress status:", botpressRes.status);
    console.log("Botpress response:", botpressRes.data);

    const reply = extractBotpressReply(botpressRes.data) || "Gracias por tu mensaje 😊";

    await sendToWati(phone, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    return res.sendStatus(200); // importante: igual 200 para que WATI no reintente en loop
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

