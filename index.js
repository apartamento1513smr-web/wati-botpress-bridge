import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL;          // Ej: https://webhook.botpress.cloud/xxxxx
const WATI_TENANT_ID = process.env.WATI_TENANT_ID;      // Ej: 1085564
const WATI_TOKEN = process.env.WATI_TOKEN;              // Ej: Bearer eyJhbGci...

if (!BOTPRESS_URL) throw new Error("Missing BOTPRESS_URL");
if (!WATI_TENANT_ID) throw new Error("Missing WATI_TENANT_ID");
if (!WATI_TOKEN) throw new Error("Missing WATI_TOKEN");

// Base correcto para WATI (según tu UI: https://live-mt-server.wati.io/{tenantId})
const WATI_BASE = `https://live-mt-server.wati.io/${WATI_TENANT_ID}`;

// Utilidad: envía mensaje por WATI (NUNCA vacío)
async function sendWatiText(phone, text) {
  const safe = (text ?? "").toString().trim();
  const messageText = safe.length ? safe : "Gracias por tu mensaje 😊";

  const url = `${WATI_BASE}/api/v1/sendSessionMessage/${encodeURIComponent(phone)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WATI_TOKEN, // déjalo tal cual lo copiaste (incluye Bearer)
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ messageText }),
  });

  const raw = await resp.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { raw }; }

  console.log("WATI send:", resp.status, json);
  return { status: resp.status, data: json };
}

// Health check
app.get("/health", (req, res) => res.send("OK"));

// 1) WATI -> Botpress -> WATI
app.post("/wati", async (req, res) => {
  try {
    // WATI "Message Received" puede variar por versión/plan.
    // Capturamos varios posibles campos:
    const text =
      req.body?.message?.text ??
      req.body?.message?.body ??
      req.body?.text ??
      req.body?.body ??
      req.body?.data?.message?.text ??
      req.body?.data?.text;

    const phone =
      req.body?.waId ??
      req.body?.whatsappNumber ??
      req.body?.contact?.waId ??
      req.body?.data?.waId ??
      req.body?.data?.whatsappNumber;

    if (!text || !phone) {
      console.log("Invalid payload from WATI:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From WATI:", phone, "text:", text);

    // Enviar a Botpress
    const botpressRes = await fetch(BOTPRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: phone,
        type: "text",
        text: text
      })
    });

    const botpressRaw = await botpressRes.text();
    let botpressData;
    try { botpressData = JSON.parse(botpressRaw); } catch { botpressData = { raw: botpressRaw }; }

    console.log("Botpress status:", botpressRes.status);
    // IMPORTANTE: deja este log mientras pruebas para ver el formato real
    console.log("Botpress response:", botpressData);

    // Extraer respuesta (varios formatos posibles)
    let reply =
      botpressData?.responses?.[0]?.payload?.text ??
      botpressData?.responses?.[0]?.text ??
      botpressData?.messages?.[0]?.payload?.text ??
      botpressData?.messages?.[0]?.text ??
      botpressData?.payload?.text ??
      botpressData?.text;

    reply = (reply ?? "").toString().trim();
    if (!reply) reply = "Gracias por tu mensaje 😊";

    // Enviar respuesta a WATI
    await sendWatiText(phone, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    return res.sendStatus(500);
  }
});

// 2) Botpress -> WATI (si decides usar este camino también)
app.post("/botpress", async (req, res) => {
  try {
    const phone = req.body?.conversationId;
    const text = req.body?.payload?.text ?? req.body?.text;

    if (!phone) return res.sendStatus(200);

    const reply = (text ?? "").toString().trim();
    await sendWatiText(phone, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Botpress->WATI error:", err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log("Server running on port", PORT));
