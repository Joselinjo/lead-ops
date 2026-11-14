// Fuente con IA: señales de intención que no tienen RSS ni API pública
// (ofertas de empleo, aperturas y expansión, apps con quejas, lanzamientos…).
// Aquí se PROPONE (generoso); la verificación estricta la hace después evaluar.mjs.
import { research } from "../lib/claude.mjs";

const TOOL = {
  name: "proponer_candidatos",
  description: "Entrega la lista de empresas con una señal reciente de necesitar lo que vendemos.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidatos"],
    properties: {
      candidatos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["empresa", "dominio", "perfil", "senal", "url", "fecha"],
          properties: {
            empresa: { type: "string" },
            dominio: { type: "string", description: "Dominio web de la empresa, o vacío si no se conoce." },
            perfil: { type: "string" },
            senal: { type: "string", description: "Qué ha pasado, en una frase, con el dato concreto." },
            url: { type: "string", description: "Fuente donde se ve la señal." },
            fecha: { type: "string", description: "AAAA-MM-DD, o vacío." },
          },
        },
      },
    },
  },
};

// Cada búsqueda va por separado (una por sector de config.descubrimiento.sectores): así cada una tiene
// sus propias búsquedas web. Lo que mejor funciona es un encargo concreto por sector con los filtros
// duros (tamaño, capacidad de pago, sin equipo propio) desde el principio.
const SYSTEM = (config) => `Eres el investigador de mercado de ${config.empresa.nombre} (${config.empresa.ciudad}). Tu trabajo es ENCONTRAR candidatos para el equipo comercial: empresas de ${config.pais} que puedan necesitar ahora lo que vendemos.
Lo que vendemos: ${config.empresa.queHacemos}
Perfiles que nos interesan: ${Object.entries(config.perfiles).map(([k, v]) => `${k}: ${v}`).join(" | ")}
Otro analista verificará a fondo cada candidato después, así que trae muchos, pero ya filtrados: cada candidato que no encaja nos cuesta una investigación. ${config.descubrimiento.filtro}\nIncluye un candidato aunque falten datos (deja vacío lo que no sepas), siempre que la empresa sea real y la señal tenga una fuente. Nunca inventes empresas, URLs ni datos.`;

export async function fetchSenalesBusqueda(config, _system, { maximo = 6, excluir = [] } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const system = SYSTEM(config);
  const perfiles = Object.keys(config.perfiles).join(" | ");
  const busquedas = config.busquedasDescubrimiento ?? 6;
  const resultados = await Promise.all(
    config.descubrimiento.sectores.map(async (b) => {
      const prompt = `Hoy es ${hoy}. Busca ${b.encargo}
${config.descubrimiento.filtro}
No propongas estas empresas, ya están en nuestro CRM o ya las investigamos: ${excluir.join(", ") || "(ninguna)"}.
Usa como mucho ${busquedas} búsquedas y entrega hasta ${maximo} candidatos con la herramienta proponer_candidatos (perfil = uno de: ${perfiles}).`;
      try {
        const r = await research({ system, prompt, tool: TOOL, maxSearches: busquedas, config });
        return (r?.candidatos ?? []).map((c) => ({ fuente: "busqueda", via: b.clave, ...c }));
      } catch (e) {
        console.warn(`  [busqueda:${b.clave}]`, e.message);
        return [];
      }
    })
  );
  return resultados.flat();
}
