// Fuente gratuita (sin tokens): rondas de financiación recientes en medios españoles por RSS.
import { XMLParser } from "fast-xml-parser";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const RONDA = /\b(ronda|capta|levanta|cierra|recauda|invierte|inversi[oó]n|pre-?seed|seed|serie a|enisa|financiaci[oó]n|millones|[0-9.,]+ ?(k|m)?€|euros)\b/i;
const NO_INTERES = /\b(fondo de fondos|ibex|bolsa|cotizad|multinacional|adquiere|compra)\b/i;

export async function fetchRondas(config, { dias = 7 } = {}) {
  const parser = new XMLParser({ ignoreAttributes: true });
  const desde = Date.now() - dias * 864e5;
  const out = [];
  for (const url of config.fuentesRondas) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = parser.parse(await res.text());
      const items = [].concat(xml?.rss?.channel?.item ?? []);
      for (const it of items) {
        const titulo = String(it.title ?? "").trim();
        const fecha = new Date(it.pubDate ?? it["dc:date"] ?? 0);
        if (!titulo || fecha.getTime() < desde) continue;
        const texto = `${titulo} ${String(it.description ?? "").replace(/<[^>]+>/g, " ")}`;
        if (!RONDA.test(texto) || NO_INTERES.test(titulo)) continue;
        out.push({
          fuente: "ronda",
          titulo,
          url: String(it.link ?? ""),
          fecha: fecha.toISOString().slice(0, 10),
          resumen: texto.replace(/\s+/g, " ").slice(0, 400),
        });
      }
    } catch (e) {
      console.warn(`  [rondas] ${url}: ${e.message}`);
    }
  }
  // Más recientes primero y sin títulos repetidos entre medios.
  const vistos = new Set();
  return out
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .filter((c) => {
      const k = c.titulo.toLowerCase().slice(0, 50);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}
