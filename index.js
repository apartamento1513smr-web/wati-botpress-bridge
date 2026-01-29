import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Env
const BOTPRESS_URL = process.env.BOTPRESS_URL; // ej: https://webhook.botpress.cloud/UUID
const BOTPRESS_API_KEY = process.env.BOTPRESS_API_KEY; // API key creada en Botpress (Bot API Keys)
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;
const WATI_TOKEN = process.env.WATI_TOKEN;

// Safety checks
if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!BOTPRESS_API_KEY) throw new Error("Missing BOTPRESS_API_KEY");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// Helpers
function extractWebhookId(url) {
  // acepta: https://webhook.botpress.cloud/<id>  o  solo <id>
  try {
    if (url.startsWith("http")) {
      const u = new URL(url);
      return u.pathname.replace("/", "").trim();
    }
    return String(url).trim();
  } catch {
    return String(url).trim();
  }
}

function normalizePhone(phone) {
  // WATI a veces manda con +, otras sin. WATI suele aceptar sin +
  return String(phone || "").replace(/[^\d]/g, "");
}

const WEBHOOK_ID = extractWebhookId(BOTPRESS_URL);
const BP_CHAT_BASE = `https://chat.botpress.cloud/44c68c71-341a-4a69-9da7-827e59b377ec/${WEBHOOK_ID}`;

// Health check
app.get("/health", (req, res) => res.send("OK"));

/**
 * 1) WATI -> Bridge -> Botpress
 * Aquí SOLO enviamos el mensaje a Botpress.
 * NO tratamos de leer respuesta, porque Botpress la enviará luego a /botpress
 * (según tu integración "Messaging API" Response Endpoint URL).
 */
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

    const cleanText = (text ?? "").toString().trim();
    const cleanPhone = normalizePhone(phone);

    if (!cleanText || !cleanPhone) {
      console.log("Invalid payload from WATI:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From WATI:", cleanPhone, "text:", cleanText);

    // (Opcional pero recomendado) asegurar conversación
    await fetch(`${BP_CHAT_BASE}/conversations/get-or-create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-key": BOTPRESS_API_KEY,
      },
      body: JSON.stringify({ id: cleanPhone }),
    });

    // Enviar mensaje al Chat API (esto es lo correcto)
    const bpRes = await fetch(`${BP_CHAT_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-key": BOTPRESS_API_KEY,
      },
      body: JSON.stringify({
        conversationId: cleanPhone,
        payload: { type: "text", text: cleanText },
      }),
    });

    console.log("Botpress status:", bpRes.status);

    const bpBodyText = await bpRes.text();
    if (bpBodyText) console.log("Botpress response:", bpBodyText);

    // Respondemos OK a WATI (Botpress responderá async a /botpress)
    return res.sendStatus(200);
  } catch (err) {
    console.error("WATI -> Botpress error:", err);
    return res.sendStatus(500);
  }
});

/**
 * 2) Botpress -> Bridge -> WATI
 * Botpress (Messaging API integration) te pega aquí con el mensaje del bot.
 */
app.post("/botpress", async (req, res) => {
  try {
    const conversationId =
      req.body?.conversationId ||
      req.body?.message?.conversationId ||
      req.body?.payload?.conversationId;

    const text =
      req.body?.payload?.text ||
      req.body?.message?.payload?.text ||
      req.body?.text;

    const cleanPhone = normalizePhone(conversationId);
    const cleanText = (text ?? "").toString().trim();

    if (!cleanPhone || !cleanText) {
      console.log("Invalid payload from Botpress:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From Botpress:", cleanPhone, "text:", cleanText);

    const watiRes = await fetch(
      `https://live-mt-server.wati.io/${WATI_TENANT_ID}/api/v1/sendSessionMessage`,
      {
        method: "POST",
        headers: {
          Authorization: WATI_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          whatsappNumber: cleanPhone,
          messageText: cleanText,
        }),
      }
    );

    const watiText = await watiRes.text();
    console.log("WATI send:", watiRes.status, watiText);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Botpress -> WATI error:", err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});


