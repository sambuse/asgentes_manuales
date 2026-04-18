const express = require("express");
const fs = require("fs");
const pdf = require("pdf-parse");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

let chunks = [];

// Dividir texto en chunks de ~400 palabras con overlap
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

// Similitud simple por palabras en común
function puntaje(query, chunk) {
  const qWords = new Set(
    query.toLowerCase()
      .replace(/[¿?¡!.,;:]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
  const cWords = chunk.toLowerCase().split(/\s+/);
  let hits = 0;
  for (const word of cWords) {
    if (qWords.has(word)) hits++;
  }
  return hits / (qWords.size || 1);
}

// Buscar los N chunks más relevantes
function buscarChunks(query, n = 3) {
  return chunks
    .map(c => ({ texto: c, score: puntaje(query, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(c => c.texto);
}

// Cargar todos los PDFs y chunkear
async function cargarPDFs() {
  const archivos = fs.readdirSync("./").filter(f => f.endsWith(".pdf"));

  if (archivos.length === 0) {
    console.log("⚠️  No se encontraron PDFs.");
    return;
  }

  for (const archivo of archivos) {
    console.log("Cargando:", archivo);
    const buffer = fs.readFileSync(archivo);
    const data = await pdf(buffer);
    const nuevosChunks = dividirEnChunks(data.text);
    chunks.push(...nuevosChunks);
    console.log(`  → ${nuevosChunks.length} chunks`);
  }

  console.log(`✅ Total chunks: ${chunks.length}`);
}

// Endpoint chat
app.post("/chat", async (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje) return res.status(400).json({ error: "Mensaje vacío" });

  console.log("Pregunta:", mensaje);

  const relevantes = buscarChunks(mensaje, 3);
  const contexto = relevantes.join("\n\n---\n\n");

  console.log(`Chunks usados: ${relevantes.length} (${contexto.length} chars)`);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: `Eres un asistente experto en los procedimientos y manuales de esta tienda.
Responde de forma clara y ordenada usando SOLO la información de los manuales.
Si la información no está en los manuales, dilo claramente.

INFORMACIÓN DE LOS MANUALES:
${contexto}`
          },
          {
            role: "user",
            content: mensaje
          }
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

app.get("/health", (req, res) =>
  res.json({ status: "ok", chunks: chunks.length })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await cargarPDFs();
  console.log(`Servidor en puerto ${PORT}`);
});