const fs = require("fs");
const pdf = require("pdf-parse");
const axios = require("axios");

// 📄 leer UN PDF
async function leerPDF(ruta) {
  const buffer = fs.readFileSync(ruta);
  const data = await pdf(buffer);
  return data.text;
}

// 📚 leer TODOS los PDFs de la carpeta
async function cargarTodosLosPDFs() {
  const archivos = fs.readdirSync("./");
  let base = "";

  for (const archivo of archivos) {
    if (archivo.endsWith(".pdf")) {
      console.log("Cargando:", archivo);
      const texto = await leerPDF(archivo);
      base += "\n" + texto;
    }
  }

  return base;
}

// 🧠 IA (Ollama)
async function preguntarIA(prompt) {
  const res = await axios.post("http://localhost:11434/api/generate", {
    model: "mistral",
    prompt: prompt,
    stream: false
  });

  return res.data.response;
}

// 🚀 main
async function main() {

  console.log("Cargando TODOS los PDFs...");
  const textoPDF = await cargarTodosLosPDFs();

  console.log("Listo. Puedes preguntar 👇");

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function preguntar() {
    readline.question("Tú: ", async (input) => {

      if (input === "salir") {
        readline.close();
        return;
      }

      const prompt = `
      Eres un asistente experto en manuales de tienda.

      Usa esta información:
      ${textoPDF.slice(0, 4000)}

      Pregunta: ${input}
      `;

      const respuesta = await preguntarIA(prompt);

      console.log("Agente:", respuesta);

      preguntar();
    });
  }

  preguntar();
}

main();