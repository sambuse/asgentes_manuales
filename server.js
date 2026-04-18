const express = require("express");
const fs = require("fs");
const pdf = require("pdf-parse");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL_TEXT = "llama-3.3-70b-versatile";
const GROQ_MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";

let chunks = [];

// ── Chunks ──
function dividirEnChunks(texto, tamano = 400, overlap = 50) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const result = [];
  for (let i = 0; i < palabras.length; i += tamano - overlap) {
    const chunk = palabras.slice(i, i + tamano).join(" ");
    if (chunk.trim().length > 50) result.push(chunk);
    if (i + tamano >= palabras.length) break;
  }
  return result;
}

function puntaje(query, chunk) {
  const qWords = new Set(
    query.toLowerCase().replace(/[¿?¡!.,;:]/g, "").split(/\s+/).filter(w => w.length > 3)
  );
  let hits = 0;
  for (const word of chunk.toLowerCase().split(/\s+/)) {
    if (qWords.has(word)) hits++;
  }
  return hits / (qWords.size || 1);
}

function buscarChunks(query, n = 4) {
  return chunks
    .map(c => ({ texto: c, score: puntaje(query, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(c => c.texto)
    .join("\n\n---\n\n");
}

async function cargarPDFs() {
  const archivos = fs.readdirSync("./").filter(f => f.endsWith(".pdf"));
  if (archivos.length === 0) { console.log("⚠️  No se encontraron PDFs."); return; }
  for (const archivo of archivos) {
    console.log("Cargando:", archivo);
    const data = await pdf(fs.readFileSync(archivo));
    const nuevos = dividirEnChunks(data.text);
    chunks.push(...nuevos);
    console.log(`  → ${nuevos.length} chunks`);
  }
  console.log(`✅ Total chunks: ${chunks.length}`);
}

// ── Endpoint: chat de texto ──
app.post("/chat", async (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje) return res.status(400).json({ error: "Mensaje vacío" });

  const contexto = buscarChunks(mensaje, 3);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL_TEXT,
        messages: [
          {
            role: "system",
            content: `Eres un asistente experto en los procedimientos y manuales de la tienda llamada "Miniso".
Responde de forma clara y ordenada usando SOLO la información de los manuales.
Si la información no está en los manuales, dilo claramente.

INFORMACIÓN DE LOS MANUALES:
${contexto}`
          },
          { role: "user", content: mensaje }
        ],
        temperature: 0.2,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Error de Groq:", err);
      return res.status(500).json({ error: "Error al contactar la IA" });
    }

    const data = await response.json();
    res.json({ respuesta: data.choices[0].message.content });

  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── Endpoint: auditoría visual con foto ──
app.post("/auditar", async (req, res) => {
  const { imagen } = req.body; // base64 sin el prefijo data:...
  if (!imagen) return res.status(400).json({ error: "Imagen vacía" });

  try {
    // Paso 1: detectar el sector con visión
    const visionRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL_VISION,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imagen}` }
              },
              {
                type: "text",
                text: `Eres un auditor visual de una tienda de retail llamada Miniso.
Analiza esta foto y responde en JSON con este formato exacto (sin markdown):
{
  "sector": "nombre del sector detectado (ej: góndola bebidas, panadería, caja, limpieza, lácteos, etc.)",
  "descripcion": "describe brevemente lo que ves en la imagen en 2-3 oraciones",
  "palabras_clave": ["palabra1", "palabra2", "palabra3"]
}`
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      })
    });

    if (!visionRes.ok) {
      const err = await visionRes.text();
      console.error("Error visión:", err);
      return res.status(500).json({ error: "Error al analizar la imagen" });
    }

    const visionData = await visionRes.json();
    let deteccion;

    try {
      const raw = visionData.choices[0].message.content;
      const clean = raw.replace(/```json|```/g, "").trim();
      deteccion = JSON.parse(clean);
    } catch {
      deteccion = {
        sector: "sector desconocido",
        descripcion: visionData.choices[0].message.content,
        palabras_clave: []
      };
    }

    console.log("Sector detectado:", deteccion.sector);

    // Paso 2: buscar chunks relevantes al sector
    const queryBusqueda = `${deteccion.sector} ${deteccion.palabras_clave.join(" ")}`;
    const contexto = buscarChunks(queryBusqueda, 4);

    // Paso 3: auditar contra el manual
    const auditRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL_TEXT,
        messages: [
          {
            role: "system",
            content: `Eres un auditor visual experto de tienda de retail.
Se detectó el siguiente sector: "${deteccion.sector}"
Descripción de la foto: "${deteccion.descripcion}"

Usa SOLO la información de los manuales para evaluar si el sector está correctamente organizado.
Si los manuales no tienen info específica del sector, indicalo y da recomendaciones generales.

Responde con este formato:
SECTOR: [nombre del sector]
VEREDICTO: ✅ Correcto / ⚠️ Necesita atención / ❌ Incorrecto

QUÉ ESTÁ BIEN:
- [punto 1]
- [punto 2]

QUÉ FALTA O ESTÁ MAL:
- [punto 1]
- [punto 2]

ACCIÓN RECOMENDADA:
[qué debe hacer el trabajador]

INFORMACIÓN DE LOS MANUALES:
${contexto}`
          },
          {
            role: "user",
            content: "Auditá el sector según lo que se ve en la foto y los manuales."
          }
        ],
        temperature: 0.2,
        max_tokens: 1024
      })
    });

    if (!auditRes.ok) {
      const err = await auditRes.text();
      console.error("Error auditoría:", err);
      return res.status(500).json({ error: "Error al auditar" });
    }

    const auditData = await auditRes.json();
    res.json({
      sector: deteccion.sector,
      descripcion: deteccion.descripcion,
      auditoria: auditData.choices[0].message.content
    });

  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", chunks: chunks.length }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await cargarPDFs();
  console.log(`Servidor en puerto ${PORT}`);
});