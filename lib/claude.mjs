// Cliente de Claude para el radar: investiga con búsqueda web y entrega el resultado
// llamando a una herramienta propia con esquema estricto (patrón "guardar_*").
import Anthropic from "@anthropic-ai/sdk";

// La clave se toma de RADAR_API_KEY si existe; si no, el SDK usa ANTHROPIC_API_KEY o el login de `ant auth login`.
const client = new Anthropic(process.env.RADAR_API_KEY ? { apiKey: process.env.RADAR_API_KEY } : {});

// Precios de lista (USD) de Claude Opus 5.5 y de la búsqueda web, para estimar el gasto.
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6, search: 10 / 1000 };

export const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, calls: 0 };

export function estimatedCost() {
  return (
    usage.input * PRICE.input +
    usage.output * PRICE.output +
    usage.cacheRead * PRICE.cacheRead +
    usage.cacheWrite * PRICE.cacheWrite +
    usage.searches * PRICE.search
  );
}

function addUsage(u = {}) {
  usage.calls += 1;
  usage.input += u.input_tokens ?? 0;
  usage.output += u.output_tokens ?? 0;
  usage.cacheRead += u.cache_read_input_tokens ?? 0;
  usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
  usage.searches += u.server_tool_use?.web_search_requests ?? 0;
}

/**
 * Ejecuta una investigación y devuelve el input de la herramienta de resultado.
 * @param {object} o
 * @param {string} o.system   Instrucciones fijas (se cachean).
 * @param {string} o.prompt   Encargo concreto.
 * @param {object} o.tool     Herramienta de resultado {name, description, input_schema}.
 * @param {number} o.maxSearches
 * @param {object} o.config   config/config.json
 */
// En la nube (red limitada) la API no deja usar web_fetch: se detecta al primer error y se
// sigue solo con web_search, con más búsquedas para compensar.
let sinWebFetch = false;
const esErrorFetch = (e) => /restricted network access/i.test(e?.message ?? "") && /web_fetch/i.test(e?.message ?? "");

export async function research(opts) {
  try {
    return await researchOnce(opts);
  } catch (e) {
    if (esErrorFetch(e)) {
      // Varias investigaciones van en paralelo: todas reintentan, solo la primera avisa.
      if (!sinWebFetch) console.warn("  [web_fetch] no disponible con red limitada: sigo solo con búsquedas web.");
      sinWebFetch = true;
      return researchOnce(opts);
    }
    throw e;
  }
}

async function researchOnce({ system, prompt, tool, maxSearches = 4, config }) {
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: sinWebFetch ? maxSearches + 4 : maxSearches, user_location: { type: "approximate", country: config.ubicacion?.pais ?? "ES", timezone: config.ubicacion?.zonaHoraria ?? "Europe/Madrid" } },
    ...(sinWebFetch ? [] : [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearches + 2, max_content_tokens: 8000 }]),
    { ...tool, strict: true },
  ];
  const messages = [{ role: "user", content: prompt }];
  let nudged = false;

  for (let turn = 0; turn < 8; turn++) {
    const resp = await client.beta.messages.create({
      model: config.modelo,
      max_tokens: 16000,
      output_config: { effort: config.esfuerzo },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: { type: "auto" },
      messages,
    });
    addUsage(resp.usage);

    if (resp.stop_reason === "refusal") { console.warn(`  [${tool.name}] rechazado`); return null; }

    const call = resp.content.find((b) => b.type === "tool_use" && b.name === tool.name);
    if (call) return call.input;

    messages.push({ role: "assistant", content: resp.content });
    if (resp.stop_reason === "pause_turn") continue; // el servidor retoma la búsqueda
    if (nudged) {
      const txt = resp.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").slice(0, 300);
      console.warn(`  [${tool.name}] sin resultado (stop_reason=${resp.stop_reason}): ${txt}`);
      return null;
    }
    nudged = true;
    messages.push({ role: "user", content: `Termina llamando a la herramienta ${tool.name} con lo que has encontrado (deja vacío lo que no sepas).` });
  }
  console.warn(`  [${tool.name}] sin resultado tras 8 turnos`);
  return null;
}

/**
 * Llamada sin búsqueda web que obliga a responder con la herramienta indicada
 * (para tareas baratas como la criba previa de candidatos).
 */
export async function decide({ system, prompt, tool, config, effort = "low" }) {
  // Opus 5.5 no admite tool_choice "tool"/"any": se pide en el texto y se insiste una vez.
  const messages = [{ role: "user", content: `${prompt}\n\nResponde llamando a la herramienta ${tool.name}.` }];
  for (let intento = 0; intento < 2; intento++) {
    const resp = await client.messages.create({
      model: config.modelo,
      max_tokens: 8000,
      output_config: { effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [{ ...tool, strict: true }],
      tool_choice: { type: "auto" },
      messages,
    });
    addUsage(resp.usage);
    const call = resp.content.find((b) => b.type === "tool_use" && b.name === tool.name);
    if (call) return call.input;
    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: `Llama ahora a ${tool.name} con tu respuesta.` });
  }
  console.warn(`  [${tool.name}] sin respuesta`);
  return null;
}
