// Vigilancia semanal de leads parados: busca señales nuevas (ronda, caída de nota, oferta de empleo,
// relanzamiento de la app…) en los leads del comercial que llevan días sin avance.
//   Entrada: data/mis-leads.json  (lo genera el cargador del CRM leyendo la vista "Mis leads")
//            [{ id, persona, empresa, proxima_accion, ultimo_contacto, nota_resumen }]
//   Salida:  output/AAAA-MM-DD/vigilancia.json  (lo aplica el cargador: nota + próxima acción)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, loadConfig, outputDir } from "./lib/store.mjs";
import { research, usage, estimatedCost } from "./lib/claude.mjs";
import { buildSystem } from "./lib/evaluar.mjs";

const config = loadConfig();
const system = buildSystem(config);
const file = join(DATA, "mis-leads.json");
if (!existsSync(file)) {
  console.error("Falta data/mis-leads.json: expórtalo de tu CRM con el formato de la cabecera de este archivo.");
  process.exit(1);
}
const leads = JSON.parse(readFileSync(file, "utf8"));

const TOOL = {
  name: "guardar_vigilancia",
  description: "Guarda si hay una señal nueva que justifique volver a llamar a este lead.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["hay_senal", "senal", "senal_url", "senal_fecha", "nota", "accion", "en_dias"],
    properties: {
      hay_senal: { type: "boolean" },
      senal: { type: "string" },
      senal_url: { type: "string" },
      senal_fecha: { type: "string" },
      nota: { type: "string", description: "Nota para el CRM: qué ha cambiado y cómo usarlo en la llamada, en 2-3 frases naturales." },
      accion: { type: "string", enum: ["Llamar", "Enviar email", "Ninguna"] },
      en_dias: { type: "integer", description: "Dentro de cuántos días (0 = hoy)." },
    },
  },
};

const hoy = new Date().toISOString().slice(0, 10);
const resultados = [];
for (const l of leads) {
  const prompt = `Hoy es ${hoy}. Este lead de ${config.empresa.comercial} está parado: ${l.persona} (${l.empresa}). Próxima acción actual: ${l.proxima_accion || "ninguna"}. Último contacto: ${l.ultimo_contacto || "desconocido"}. Contexto: ${l.nota_resumen || "sin notas"}.
Busca si en las últimas 3 semanas ha pasado algo nuevo que dé un motivo para volver a llamar: ronda o ayuda, ofertas de empleo técnicas, relanzamiento o caída de nota de su app, noticias, cambio de directivos. Si no hay nada nuevo y relevante, hay_senal=false y accion="Ninguna". Usa como mucho 2 búsquedas y termina con guardar_vigilancia.`;
  try {
    const r = await research({ system, prompt, tool: TOOL, maxSearches: 2, config });
    if (r) resultados.push({ ...l, ...r });
    console.log(`${r?.hay_senal ? "★" : "·"} ${l.empresa}: ${r?.senal || "sin novedades"}`);
  } catch (e) {
    console.warn(`! ${l.empresa}: ${e.message}`);
  }
}

const dir = outputDir();
writeFileSync(join(dir, "vigilancia.json"), JSON.stringify(resultados, null, 2));
console.log(`Listo: ${resultados.filter((r) => r.hay_senal).length} con señal nueva de ${leads.length}. Coste estimado: ${estimatedCost().toFixed(2)} $ (${usage.searches} búsquedas).`);
