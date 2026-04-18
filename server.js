const express = require("express");
const fs = require("fs");
const pdf = require("pdf-parse");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "mistral-saba-24b"; // Mistral en Groq

let BASE = "";

// Cargar PDFs al iniciar
async function cargarPDFs() {
  const archivos = fs.readdirSync("./");
  for (const archivo of archivos) {
    if (archivo.endsWith(".pdf")) {
      console.log("Cargando PDF:", archivo);
      const buffer = fs.readFileSync(archivo);
      const data = await pdf(buffer);
      BASE += "\n" + data.text;
    }
  }
  console.log(`PDFs cargados. Caracteres en base: ${BASE.length}`);
}

// Endpoint IA
app.post("/chat", async (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje) return res.status(400).json({ error: "Mensaje vacío" });

  console.log("Pregunta recibida:", mensaje);

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
            content: `Eres un asistente experto en manuales de tienda.
Usa esta información de los manuales para responder:
${BASE.slice(0, 6000)}`
          },
          {
            role: "user",
            content: mensaje
          }
        ],
        temperature: 0.3,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Error de Groq:", err);
      return res.status(500).json({ error: "Error al contactar la IA" });
    }

    const data = await response.json();
    const respuesta = data.choices[0].message.content;

    res.json({ respuesta });

  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Health check para Railway
app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await cargarPDFs();
  console.log(`Servidor corriendo en puerto ${PORT}`);
});