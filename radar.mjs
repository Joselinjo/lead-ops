// Radar diario de leads: encuentra empresas con una señal de necesitar lo que vendes, las investiga a fondo
// con Claude y deja cada lead con su ficha y su correo en frío escrito, listos para importar al CRM.
// Inspirado en career-ops (MIT, Santiago Fernández de Valderrama): buscar gratis, usar la IA solo para evaluar.
//   node radar.mjs                 ejecución normal
//   node radar.mjs --solo-gratis   solo fuentes gratuitas, sin llamar a Claude (para probar)
//   node radar.mjs --max 3         evalúa como mucho 3 candidatos (prueba barata)
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, buildExcluder, loadSeen, saveSeen, outputDir, csvEscape, norm, DATA } from "./lib/store.mjs";
import { fetchRondas } from "./sources/rondas.mjs";
import { fetchApps } from "./sources/apps.mjs";
import { fetchSenalesBusqueda } from "./sources/busqueda.mjs";
import { buildSystem, evaluar, cribar } from "./lib/evaluar.mjs";
import { usage, estimatedCost } from "./lib/claude.mjs";

const args = process.argv.slice(2);
const soloGratis = args.includes("--solo-gratis");
const maxArg = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : null;
const reusar = args.includes("--reusar"); // reutiliza los candidatos ya buscados hoy (no repite el gasto de búsqueda)

const config = loadConfig();
const isExcluded = buildExcluder();
const seen = loadSeen();
const system = buildSystem(config);
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// 1. Fuentes. Las gratuitas se consultan siempre; la búsqueda con IA (de pago) se guarda en
// candidatos.json y con --reusar se reaprovecha la de hoy.
const cacheFuentes = join(outputDir(), "candidatos.json");
log("Buscando señales…");
const [rondas, apps] = await Promise.all([fetchRondas(config), fetchApps(config, isExcluded)]);
log(`  rondas: ${rondas.length} · apps: ${apps.length}`);
let busqueda = [];
if (reusar && existsSync(cacheFuentes)) {
  busqueda = JSON.parse(readFileSync(cacheFuentes, "utf8")).busqueda ?? [];
  log(`  señales de búsqueda (reutilizadas de hoy): ${busqueda.length}`);
} else if (!soloGratis) {
  // Lo que no hay que volver a proponer: lista de exclusión (CRM y trabajadas) y lo ya investigado.
  const ficheroExcluir = join(DATA, "excluir.txt");
  const listaExcluir = (existsSync(ficheroExcluir) ? readFileSync(ficheroExcluir, "utf8") : "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.includes("."));
  const excluir = [...new Set([...listaExcluir, ...Object.keys(seen).filter((k) => !k.includes(" ") || k.length < 30).slice(-250)])].slice(0, 500);
  busqueda = await fetchSenalesBusqueda(config, system, { maximo: config.candidatosPorBusqueda ?? 6, excluir }).catch((e) => (console.warn("  [busqueda]", e.message), []));
  log(`  señales de búsqueda: ${busqueda.length}`);
}
writeFileSync(cacheFuentes, JSON.stringify({ rondas, apps, busqueda }, null, 2));

// 2. Mezcla equilibrada (una de cada fuente por turno) sin repetidos ni excluidos
// Las búsquedas y las apps van primero; de las rondas solo las que hablan de app, plataforma o negocio
// con clientes (las de deep tech, biotech o IA casi siempre tienen ya director técnico).
const RONDA_UTIL = /\b(app|aplicaci[oó]n|plataforma|digital|e-?commerce|tienda|cadena|franquicia|apertura|clientes|factura)/i;
const fila = [];
const fuentes = [
  busqueda.filter((c) => !isExcluded(c.empresa, c.dominio)),
  apps.filter((c) => !isExcluded(c.vendedor, c.app, c.web)),
  rondas.filter((c) => RONDA_UTIL.test(`${c.titulo} ${c.resumen}`)).slice(0, 12),
];
for (let i = 0; fila.length < 150 && fuentes.some((f) => f[i]); i++) for (const f of fuentes) if (f[i]) fila.push(f[i]);
const clave = (c) => norm(c.dominio || c.web || c.vendedor || c.empresa || c.titulo);
const candidatos = fila.filter((c, i, a) => a.findIndex((x) => clave(x) === clave(c)) === i && !seen[clave(c)]);
const limite = maxArg ?? config.candidatosAEvaluar;
log(`Candidatos nuevos: ${candidatos.length}. Se evalúan ${Math.min(limite, candidatos.length)}.`);

if (soloGratis) {
  candidatos.slice(0, limite).forEach((c) => console.log(" -", c.fuente, "|", c.app || c.empresa || c.titulo));
  process.exit(0);
}

// 3. Criba previa barata (sin búsquedas): elige los más prometedores para investigar a fondo.
let cola = candidatos.slice(0, limite);
if (candidatos.length > limite) {
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const yaInvestigadas = Object.entries(seen).filter(([, v]) => v.fecha >= hace30).map(([k]) => k).slice(-200);
  const { elegidos, descartados } = await cribar(candidatos, limite, { config, system, yaInvestigadas })
    .catch((e) => (console.warn("  [criba]", e.message), { elegidos: [], descartados: [] }));
  // Los descartes de la criba NO se guardan en vistos: la criba es rápida y puede equivocarse.
  if (elegidos.length) cola = elegidos;
  log(`Criba: ${elegidos.length} elegidos, ${descartados.length} descartados.`);
  elegidos.forEach((c) => log(`  → ${c.app || c.empresa || c.titulo}: ${c.motivo_criba}`));
}

// 4. Evaluación a fondo con Claude (varias en paralelo)
const evaluados = [];
let investigados = 0;
async function worker() {
  while (cola.length) {
    // Tope de gasto diario: se para antes de pasarse (el límite mensual es de 500 $).
    if (estimatedCost() > (config.presupuestoDiario ?? Infinity)) {
      log(`  Presupuesto diario alcanzado (${estimatedCost().toFixed(2)} $). Quedan ${cola.length} sin investigar.`);
      cola.length = 0;
      break;
    }
    const c = cola.shift();
    if (isExcluded(c.empresa, c.dominio, c.vendedor, c.web)) { log("  · ya investigada:", c.app || c.empresa); continue; }
    investigados++;
    try {
      const r = await evaluar(c, { config, system });
      if (!r) { log("  ✗ sin resultado:", c.app || c.empresa || c.titulo); continue; }
      const descartado = r.descartar || isExcluded(r.empresa, r.dominio) || r.perfil === "Ninguno";
      seen[clave(c)] = { fecha: new Date().toISOString().slice(0, 10), resultado: descartado ? "descartado" : "propuesto", motivo: r.motivo_descarte || "" };
      // Se guarda también por dominio y por nombre, para no investigar la misma empresa otro día
      // cuando llega por otra fuente.
      if (r.dominio) seen[norm(r.dominio)] = seen[clave(c)];
      if (r.empresa && norm(r.empresa).length > 3) seen[norm(r.empresa)] = seen[clave(c)];
      log(descartado ? `  ✗ ${r.empresa || c.titulo}: ${r.motivo_descarte || "excluido"}` : `  ✓ ${r.empresa} (calor ${r.calor})`);
      if (!descartado) evaluados.push({ ...r, origen: c });
    } catch (e) {
      log("  ! error evaluando:", e.message);
    }
  }
}
await Promise.all(Array.from({ length: config.investigacionesEnParalelo ?? 5 }, worker));

// 5. Los leads del día. Calidad frente a cantidad: no hay cupo. Solo sale con correo quien tiene una
// señal activa verificada y calor >= calidad.calorMinimoCorreo; los de calor 4-5 con via=llamar llevan
// además merece_llamada. Las «cuentas top» (calor 5 con una de calidad.senalesTop) no se envían solas:
// la rutina local les prepara un plan de cuenta (vídeo, LinkedIn, correo y llamada) para que el comercial
// las trabaje a mano. Lo que encaja y puede pagar pero no tiene señal va a data/vigilar.json.
const calidad = config.calidad ?? {};
const minCorreo = calidad.calorMinimoCorreo ?? 3;
const senalesTop = new Set(calidad.senalesTop ?? []);
const conSenal = (l) => !config.calidad || (l.tipo_senal && l.tipo_senal !== "ninguna");
const pasa = (l) => l.puede_pagar !== false && l.calor >= minCorreo && conSenal(l) && l.correo;
const leads = evaluados
  .filter(pasa)
  .sort((a, b) => b.calor - a.calor)
  .slice(0, config.correosPorDia ?? Infinity)
  .map((l) => {
    const merece_llamada = l.calor >= (config.calorMinimo ?? 4) && l.via === "llamar";
    const cuenta_top = merece_llamada && l.calor >= 5 && senalesTop.has(l.tipo_senal);
    return { ...l, accion: cuenta_top ? "Plan de cuenta" : "Enviar email", merece_llamada, cuenta_top };
  });
const paraLlamar = leads.filter((l) => l.merece_llamada);
const paraCorreo = leads.filter((l) => !l.cuenta_top);
const cuentasTop = leads.filter((l) => l.cuenta_top);

// Vigilancia: los que encajan y pueden pagar pero aún no tienen señal (se repasan cada semana).
const ficheroVigilar = join(DATA, "vigilar.json");
const vigilar = existsSync(ficheroVigilar) ? JSON.parse(readFileSync(ficheroVigilar, "utf8")) : [];
const hoy = new Date().toISOString().slice(0, 10);
const hace90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
const nuevosVigilar = evaluados.filter((l) => !pasa(l) && l.puede_pagar !== false && l.calor >= 3);
for (const l of nuevosVigilar) {
  const k = norm(l.dominio || l.empresa);
  const i = vigilar.findIndex((v) => norm(v.dominio || v.empresa) === k);
  const entrada = { fecha: hoy, empresa: l.empresa, dominio: l.dominio, perfil: l.perfil, calor: l.calor, tipo_senal: l.tipo_senal || "ninguna", senal: l.senal, por_que: l.por_que_ahora, decisor: [l.decisor_nombre, l.decisor_cargo].filter(Boolean).join(", "), facturacion: l.facturacion_estimada, resenas: l.tiendas?.resumen ?? "" };
  if (i >= 0) vigilar[i] = entrada; else vigilar.push(entrada);
}
writeFileSync(ficheroVigilar, JSON.stringify(vigilar.filter((v) => v.fecha >= hace90), null, 2));
const dir = outputDir();
writeFileSync(join(dir, "leads.json"), JSON.stringify(leads, null, 2));

// Fichas legibles (y el texto exacto que va como nota en el CRM).
const nota = (l) =>
  `Ficha del radar (${new Date().toISOString().slice(0, 10)}) · Calor ${l.calor}/5 · ${l.perfil}${l.tipo_senal ? ` · Señal: ${l.tipo_senal}` : ""}. ` +
  (l.cuenta_top ? "CUENTA TOP: se trabaja a mano con plan de cuenta (vídeo, LinkedIn, correo y llamada); su correo no se envía solo. " : "") +
  (l.facturacion_estimada ? `Tamaño: ${l.facturacion_estimada}. ` : "") +
  (l.tiendas?.resumen ? `${l.tiendas.resumen} ` : "") +
  `Por qué ahora: ${l.por_que_ahora} Señal: ${l.senal}${l.senal_url ? ` (${l.senal_url})` : ""}. ` +
  `Apertura: «${l.apertura}» Gancho: ${l.gancho} Pregunta clave: «${l.pregunta_clave}» ` +
  `Si dice «${l.objecion_probable}»: «${l.respuesta_objecion}»` +
  (l.telefono_fuente ? ` Teléfono: ${l.telefono_fuente}.` : "") +
  ` ${l.cuenta_top ? "" : l.merece_llamada ? "MERECE LLAMADA unos días después del envío." : "Solo correo: si no contesta, no se llama."} Asunto: «${l.asunto_correo}». Correo: ${l.correo}`;
leads.forEach((l) => (l.nota_crm = nota(l)));
writeFileSync(join(dir, "leads.json"), JSON.stringify(leads, null, 2));

// CSV con cabeceras estándar (Nombre, Apellidos, Cargo, Empresa, Email…) que casi cualquier importador
// de CRM reconoce solo. Si tu CRM no guarda las notas del CSV en el historial, la rutina del CRM puede
// pegar nota_crm (de leads.json) como nota y poner la próxima acción a mano. Temperatura: A = calor 5, B = 4, C = 3.
const temperatura = (c) => (c >= 5 ? "A" : c === 4 ? "B" : "C");
const cab = ["Nombre", "Apellidos", "Cargo", "Empresa", "Email", "Teléfono", "Web", "LinkedIn", "Ciudad", "Temperatura", "Notas"];
const filas = leads.map((l) => {
  const parts = (l.decisor_nombre || "").trim().split(/\s+/).filter(Boolean);
  return [
    parts[0] || `Contacto ${l.empresa}`, parts.slice(1).join(" "), l.decisor_cargo, l.empresa, l.email_publico, l.telefono_publico,
    l.dominio, l.decisor_linkedin, l.ciudad, temperatura(l.calor), l.nota_crm,
  ];
});
writeFileSync(join(dir, "leads-crm.csv"), [cab, ...filas].map((f) => f.map(csvEscape).join(",")).join("\n") + "\n");
writeFileSync(
  join(dir, "fichas.md"),
  `# Leads del ${new Date().toLocaleDateString("es-ES")}\n\n` +
    leads.map((l, i) => `## ${i + 1}. ${l.cuenta_top ? "⭐ " : l.merece_llamada ? "📞 " : "✉️ "}${l.empresa} · calor ${l.calor}/5\n**${l.decisor_nombre || "Decisor por confirmar"}** (${l.decisor_cargo || "—"}) · ${l.telefono_publico || "sin teléfono público"} · ${l.dominio}\n\n${l.nota_crm}\n${l.candidato_revelar_movil ? `\n**Merece conseguir su móvil:** ${l.justificacion_movil || ""}\n` : ""}`).join("\n")
);

saveSeen(seen);
const coste = estimatedCost();
writeFileSync(join(dir, "resumen.json"), JSON.stringify({ leads: leads.length, correos: paraCorreo.length, merecenLlamada: paraLlamar.length, cuentasTop: cuentasTop.length, aVigilar: nuevosVigilar.length, investigados, evaluados: evaluados.length, usage, costeEstimadoUSD: Number(coste.toFixed(2)) }, null, 2));
log(`Listo: ${leads.length} leads con señal activa (${cuentasTop.length} cuentas top, ${paraLlamar.length} merecen llamada) y ${nuevosVigilar.length} a vigilar, en ${dir}. Coste estimado: ${coste.toFixed(2)} $ (${usage.searches} búsquedas, ${usage.calls} llamadas a Claude).`);
