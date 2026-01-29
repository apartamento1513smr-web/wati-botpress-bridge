import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;

const BOTPRESS_URL = process.env.BOTPRESS_URL; // webhook.botpress.cloud/...
const WATI_TOKEN = process.env.WATI_TOKEN; // debe incluir "Bearer ..."
const WATI_API_ENDPOINT = process.env.WATI_API_ENDPOINT; // https://live-mt-server.wati.io/<tenantId>

// Safety checks
if (!BOTPRESS_URL) throw new Error("Missing env: BOTPRESS_URL");
if (!WATI_TOKEN) throw new Error("Missing env: WATI_TOKEN");
if (!WATI_API_ENDPOINT) throw new Error("Missing env: WATI_API_ENDPOINT");

// Helpers
const cleanPhone = (p) => (p ? String(p).replace(/[^\d]/g, "") : "");

// WATI sender (endpoint robusto)
async function sendToWati(phone, messageText) {
  const to = cleanPhone(phone);
  const url = `${WATI_API_ENDPOINT}/api/v1/sendSessionMessage/${to}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WATI_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: messageText }),
  });

  const body = await r.text();
  console.log("WATI send:", r.status, body);
  return { ok: r.ok, status: r.status, body };
}

// Botpress sender
async function sendToBotpress(conversationId, text) {
  const r = await fetch(BOTPRESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: String(conversationId),
      type: "text",
      text: String(text),
    }),
  });

  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  console.log("Botpress status:", r.status);
  if (!r.ok) console.log("Botpress error body:", raw);

  return { ok: r.ok, status: r.status, raw, data };
}

// Health check
app.get("/health", (req, res) => res.send("OK"));

// Receive from WATI
app.post("/wati", async (req, res) => {
  try {
    // Log mínimo del payload (sin tokens)
    console.log("WATI webhook received keys:", Object.keys(req.body || {}));

    // Text: WATI puede mandarlo en distintos campos
    const text =
      req.body?.message?.text ||
      req.body?.message?.body ||
      req.body?.text ||
      req.body?.messageText ||
      req.body?.data?.text ||
      req.body?.data?.message?.text ||
      req.body?.data?.message?.body;

    // Phone: WATI puede mandarlo como waId / whatsappNumber / contact.waId / data.waId...
    const phone =
      req.body?.waId ||
      req.body?.whatsappNumber ||
      req.body?.contact?.waId ||
      req.body?.contact?.whatsappNumber ||
      req.body?.data?.waId ||
      req.body?.data?.whatsappNumber ||
      req.body?.data?.contact?.waId ||
      req.body?.data?.contact?.whatsappNumber;

    const p = cleanPhone(phone);

    if (!text || !p) {
      console.log("Invalid payload from WATI. Body:", JSON.stringify(req.body));
      return res.sendStatus(200); // WATI espera 200
    }

    console.log("From WATI:", p, "text:", text);

    // Enviar a Botpress
    const bp = await sendToBotpress(p, text);

    // Obtener reply del Botpress (varios formatos posibles)
    let reply =
      bp?.data?.responses?.[0]?.payload?.text ||
      bp?.data?.responses?.[0]?.text ||
      bp?.data?.payload?.text ||
      "Gracias por tu mensaje 😊";

    // Si Botpress devolvió algo raro, muestra parte del raw para depurar
    if (!bp.ok) {
      reply = "Estoy teniendo un problema técnico. Intenta de nuevo en 1 minuto 🙏";
    }

    // Enviar respuesta a WATI
    await sendToWati(p, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Bridge error:", err);
    // Igual devolvemos 200 para que WATI no reintente infinito
    return res.sendStatus(200);
  }
});

// Receive from Botpress (cuando Botpress use Response Endpoint URL)
app.post("/botpress", async (req, res) => {
  try {
    const conversationId =
      req.body?.conversationId ||
      req.body?.conversation?.id ||
      req.body?.payload?.conversationId;

    const phone = cleanPhone(conversationId);

    const text =
      req.body?.payload?.text ||
      req.body?.text ||
      req.body?.payload?.message?.text;

    if (!phone || !text) {
      console.log("Botpress webhook invalid body:", JSON.stringify(req.body));
      return res.sendStatus(200);
    }

    console.log("From Botpress:", phone, "text:", text);

    await sendToWati(phone, text);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Botpress->WATI error:", err);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
