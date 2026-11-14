// Evaluador: convierte un candidato en un lead listo para escribirle (y llamarle si merece la pena),
// o lo descarta con su motivo. Todo lo propio de tu empresa sale de config/config.json.
import { research, decide } from "./claude.mjs";

const lista = (xs = []) => xs.map((x) => `- ${x}`).join("\n");

export function buildSystem(config) {
  const e = config.empresa;
  const p = config.capacidadPago;
  const c = config.correo;
  return `Eres el analista comercial de ${e.nombre} (${e.ciudad}). Tu trabajo es preparar leads para que ${e.comercial}, del equipo comercial, solo tenga que escribir y llamar.

QUÉ VENDEMOS
${e.queHacemos}
${e.pruebas ?? ""}

CÓMO VENDEMOS
${e.metodo ?? ""}

PERFILES DE CLIENTE (segmentos del CRM)
${Object.entries(config.perfiles).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

DESCARTA SIEMPRE
${lista(config.reglasDescarte)}
- Empresas que no pueden pagar al menos ${p.minimo}: ${p.criterio}.

CALOR (1-5)
- 5: problema claro y verificado + señal de que quieren resolverlo en las últimas semanas + pueden pagar + sabemos quién decide.
- 4: problema claro y capacidad de pago, señal algo menos reciente o decisor por confirmar.
- 3: encaja pero sin señal de urgencia.
- 1-2: dudoso. Mejor descartar.

ESTILO DE LA FICHA
${lista(config.estilo)}

DATOS DE CONTACTO
- Teléfono: busca el teléfono PÚBLICO de la empresa (su web, aviso legal, directorios de empresas). Indica de dónde sale. Nunca inventes un número.
- Email: solo si es público (web, aviso legal). Nunca deduzcas emails personales.
- Decisor: fundador, CEO, gerente o responsable digital, con su cargo y, si aparece, su LinkedIn público.

VÍA: TODOS EMPIEZAN POR CORREO
Descartar es solo para quien incumple una regla de descarte o no se sostiene (señal falsa, empresa cerrada, sin dinero). Si la empresa encaja y puede pagar, NO la descartes porque le falte urgencia: guárdala.
Todos los leads que guardes reciben primero un correo, así que escribe SIEMPRE asunto_correo y correo. Con via indicas si además merece una llamada unos días después del envío:
- via="llamar": calor 4-5, problema claro y verificado, puede pagar de sobra y sabemos a quién pedir. Solo los mejores: llamar cuesta tiempo (y créditos, si hay que conseguir el móvil del decisor).
- via="correo": el resto de los que encajan; si no contestan, no se les llama.
${lista(config.notasEvaluacion)}

EL CORREO (asunto_correo y correo), con el estilo de ${e.comercial}:
«Muy buenas, [nombre]:» (o «Muy buenas:» si no conoces el nombre) · «Soy ${e.comercial}, de ${e.nombre}. [quiénes somos en una frase, adaptado a su caso].» · el motivo concreto (la señal, con el dato) · si encaja: «${c.ofertaConGancho}»; si no: «${c.ofertaSinGancho}» · «Un saludo,» y «${e.firma}» en otra línea.
${lista(c.reglas)}

Sé escéptico: verifica la señal en la fuente original y comprueba que la empresa sigue viva. Si incumple una regla de descarte, descarta y explica por qué.`;
}

const PERFILES = (config) => Object.keys(config.perfiles);

export function leadTool(config) {
  const s = { type: "string" };
  const props = {
    descartar: { type: "boolean" },
    motivo_descarte: s,
    empresa: s, dominio: s, ciudad: s,
    perfil: { type: "string", enum: [...PERFILES(config), "Ninguno"] },
    decisor_nombre: s, decisor_cargo: s, decisor_linkedin: s,
    telefono_publico: s, telefono_fuente: s, email_publico: s,
    senal: { type: "string", description: "La señal concreta, con dato (nota, importe, puesto…)." },
    senal_url: s, senal_fecha: s,
    facturacion_estimada: { type: "string", description: "Facturación anual o ronda levantada, con la cifra y la fuente (registro mercantil, prensa, LinkedIn…). Vacío si no se encuentra." },
    puede_pagar: { type: "boolean", description: `true si con lo encontrado puede pagar al menos ${config.capacidadPago.minimo} (${config.capacidadPago.criterio}).` },
    calor: { type: "integer", enum: [1, 2, 3, 4, 5] },
    via: { type: "string", enum: ["llamar", "correo"], description: "Todos reciben correo. llamar = además merece llamada unos días después (calor 4-5, problema verificado, paga de sobra, sabemos a quién pedir)." },
    asunto_correo: { type: "string", description: "Asunto del correo en frío (siempre, salvo si se descarta)." },
    correo: { type: "string", description: "El correo en frío completo, listo para revisar y enviar (siempre, salvo si se descarta). Párrafos separados por una línea en blanco." },
    por_que_ahora: { type: "string", description: "Por qué contactar esta semana, en 1-2 frases." },
    apertura: { type: "string", description: "Apertura de la llamada, para decir tal cual." },
    gancho: { type: "string", description: `Qué le ofrecemos (${config.empresa.gancho ?? "la oferta gratuita"}) y cómo decirlo.` },
    pregunta_clave: s,
    objecion_probable: s, respuesta_objecion: s,
    candidato_revelar_movil: { type: "boolean", description: "true solo si es calor 4-5, el decisor está confirmado con fuente y no hay teléfono directo suyo público: merece gastar un crédito para conseguir su móvil." },
    justificacion_movil: { type: "string", description: "Por qué merece (o no) conseguir su móvil, con las pruebas encontradas." },
  };
  return {
    name: "guardar_lead",
    description: "Guarda el lead evaluado (o descartado con su motivo). Deja vacío lo que no sepas.",
    input_schema: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props },
  };
}

export function describeCandidate(c) {
  if (c.fuente === "app")
    return `App "${c.app}" de ${c.vendedor} (${c.web || "web desconocida"}). Nota ${c.nota} con ${c.valoraciones} valoraciones en App Store, actualizada el ${c.actualizada}. Categoría: ${c.categoria}. Ficha: ${c.url}. Descripción: ${c.descripcion}`;
  if (c.fuente === "ronda")
    return `Noticia del ${c.fecha}: "${c.titulo}". ${c.url}. Resumen: ${c.resumen}`;
  return `${c.empresa} (${c.dominio || "dominio desconocido"}). Señal (${c.fecha || "sin fecha"}): ${c.senal}. Fuente: ${c.url}. Perfil sugerido: ${c.perfil}`;
}

export async function evaluar(candidato, { config, system }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const p = config.capacidadPago;
  const prompt = `Hoy es ${hoy}. Evalúa este candidato para contactarlo esta semana:

${describeCandidate(candidato)}

Tómate el tiempo que haga falta: investigar bien es lo que justifica el contacto.
1. Verifica la señal y que la empresa es de ${config.pais}, está viva y no cumple ninguna regla de descarte. Contrasta al menos dos fuentes (web de la empresa, noticias, LinkedIn, registros, ficha de la app).
2. Comprueba que puede pagarnos: lo mínimo es ${p.minimo}. Busca su facturación o la ronda que ha levantado, y su número de empleados. Si ${p.descarteSi}, descártalo.
3. Mira el dolor de cerca: opiniones recientes de la app (qué se repite), cuándo se actualizó, quién la desarrolló (¿proveedor externo?, ¿equipo propio?), tamaño de la empresa y si ya tienen equipo técnico.
4. Confirma al decisor real: nombre, cargo y LinkedIn, y que sigue en la empresa hoy. Busca su teléfono directo o el de la empresa y su email público.
5. Si vale: escribe la ficha (apertura, gancho, pregunta clave, objeción probable y respuesta) con los datos concretos que hayas encontrado.
6. Pon calor 4-5 solo si puede pagar y si contactarle esta semana tiene sentido de verdad, y candidato_revelar_movil solo si el decisor está confirmado y no hay teléfono directo suyo.
7. Escribe el correo (todos empiezan por correo) y elige la vía: llamar solo si además merece llamada; si no, correo. Que no corra prisa no es motivo para descartar.
8. Termina llamando a guardar_lead.
Usa como mucho ${config.busquedasPorLead} búsquedas.`;
  return research({ system, prompt, tool: leadTool(config), maxSearches: config.busquedasPorLead, config });
}

// Criba previa: de todos los candidatos del día elige los que merece la pena investigar a fondo.
const CRIBA = {
  name: "elegir_candidatos",
  description: "Devuelve los candidatos elegidos para investigar (por prioridad) y los claramente descartables.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["elegidos", "descartados"],
    properties: {
      elegidos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["indice", "motivo"],
          properties: { indice: { type: "integer" }, motivo: { type: "string", description: "Por qué puede ser un lead, en una frase." } },
        },
      },
      descartados: { type: "array", items: { type: "integer" }, description: "Índices que no encajan de ninguna manera." },
    },
  },
};

export async function cribar(candidatos, cuantos, { config, system, yaInvestigadas = [] }) {
  const listaCandidatos = candidatos.map((c, i) => `[${i}] (${c.fuente}) ${describeCandidate(c).slice(0, 450)}`).join("\n");
  const p = config.capacidadPago;
  const prompt = `Estos son los candidatos de hoy. Investigar cada uno a fondo cuesta dinero, así que elige como mucho ${cuantos}: los que tienen más pinta de ser un buen lead según nuestros perfiles. Ordénalos de más a menos prometedor.

PRIMER FILTRO: que puedan pagar al menos ${p.minimo} (${p.criterio}).

LO QUE MEJOR NOS FUNCIONA (prioriza esto):
${lista(config.criba?.prioriza)}

LO QUE CASI NUNCA FUNCIONA:
${lista(config.criba?.evita)}

Marca como descartados solo los que no encajan de ninguna manera. No elijas ninguna empresa que ya hayamos investigado en los últimos 30 días: ${yaInvestigadas.join(", ") || "(ninguna)"}.

Mejor elegir pocos y buenos que llenar el cupo.

${listaCandidatos}`;
  const r = await decide({ system, prompt, tool: CRIBA, config: { ...config }, effort: "medium" });
  const valido = (i) => Number.isInteger(i) && i >= 0 && i < candidatos.length;
  return {
    elegidos: (r?.elegidos ?? []).filter((e) => valido(e.indice)).slice(0, cuantos).map((e) => ({ ...candidatos[e.indice], motivo_criba: e.motivo })),
    descartados: (r?.descartados ?? []).filter(valido).map((i) => candidatos[i]),
  };
}
