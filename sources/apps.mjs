// Fuente gratuita (sin tokens), vía la API pública de búsqueda de App Store:
//   1. apps con nota baja pero vivas;
//   2. apps con buena nota general pero un BAJÓN reciente: actualizadas hace poco y con un pico de quejas
//      en las reseñas de los últimos meses (se comprueba con el feed público de reseñas).
import { resenasIOS, analizar } from "../lib/resenas.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Grandes tecnológicas y formas societarias de otros países: no son nuestro cliente.
const GRANDES_O_EXTRANJERAS = /\b(apple|google|microsoft|amazon|meta|samsung|inc\.?|llc|ltd\.?|limited|gmbh|s\.r\.l\.?|srl|b\.v\.?|sas|s\.a\.s|pty|ag|dominican[oa]|m[eé]xico|colombia|argentina|chile|per[uú])\b/i;

const CATEGORIAS_FUERA = new Set(["Games", "Juegos", "Finance", "Finanzas", "News", "Noticias", "Reference", "Consulta", "Book", "Libros", "Developer Tools"]);

export async function fetchApps(config, isExcluded) {
  const { notaMaxima, valoracionesMinimas, mesesMaxSinActualizar } = config.filtroApps;
  const limiteFecha = Date.now() - mesesMaxSinActualizar * 30 * 864e5;
  const porId = new Map();
  const posiblesBajones = new Map(); // buena nota general, pero actualizadas hace poco: se revisan sus reseñas
  const hace60 = Date.now() - 60 * 864e5;

  for (const term of config.busquedasApps) {
    try {
      const url = `https://itunes.apple.com/search?country=${config.tiendaApps?.pais ?? "es"}&lang=${config.tiendaApps?.idioma ?? "es_es"}&entity=software&limit=50&term=${encodeURIComponent(term)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { results = [] } = await res.json();
      for (const a of results) {
        const nota = a.averageUserRatingForCurrentVersion ?? a.averageUserRating ?? 5;
        const valoraciones = a.userRatingCount ?? 0;
        const actualizada = new Date(a.currentVersionReleaseDate ?? 0);
        if (valoraciones < valoracionesMinimas) continue;
        if (actualizada.getTime() < limiteFecha) continue; // abandonada
        if (valoraciones > (config.filtroApps.valoracionesMaximas ?? 20000)) continue; // demasiado grande: suele tener equipo propio
        if (GRANDES_O_EXTRANJERAS.test(a.sellerName ?? "")) continue;
        if (CATEGORIAS_FUERA.has(a.primaryGenreName)) continue; // juegos, bancos, prensa, diccionarios: no son nuestro cliente
        if (isExcluded(a.sellerName, a.trackName, a.sellerUrl)) continue;
        const destino = nota <= notaMaxima ? porId : actualizada.getTime() >= hace60 ? posiblesBajones : null;
        if (!destino) continue;
        destino.set(a.trackId, {
          fuente: "app",
          trackId: a.trackId,
          app: a.trackName,
          vendedor: a.sellerName,
          web: a.sellerUrl ?? "",
          nota: Math.round(nota * 100) / 100,
          valoraciones,
          actualizada: actualizada.toISOString().slice(0, 10),
          url: a.trackViewUrl,
          categoria: a.primaryGenreName,
          descripcion: String(a.description ?? "").replace(/\s+/g, " ").slice(0, 300),
        });
      }
    } catch (e) {
      console.warn(`  [apps] "${term}": ${e.message}`);
    }
    await sleep(3200); // la API pública admite ~20 peticiones por minuto
  }
  // Bajones: de las bien valoradas actualizadas hace poco, las que más usuarios tienen primero.
  const revisar = [...posiblesBajones.values()].filter((a) => !porId.has(a.trackId)).sort((a, b) => b.valoraciones - a.valoraciones).slice(0, config.resenas?.revisarBajones ?? 40);
  let bajones = 0;
  for (const a of revisar) {
    try {
      const r = analizar(await resenasIOS(a.trackId, config.tiendaApps?.pais ?? "es", 2), config.resenas);
      if (r.pico) {
        const v = r.porVersion[0];
        a.bajon = `BAJÓN RECIENTE: ${Math.round(r.negativasRecientes * 100)} % de reseñas de 1-2★ en los últimos ${config.resenas?.dias ?? 90} días${r.caidaVersion && v ? `, sobre todo desde la versión ${v.version} (${v.desde})` : ""}; antes, media de ${r.mediaAnteriores?.toFixed(1) ?? "—"}★.`;
        porId.set(a.trackId, a);
        bajones++;
      }
    } catch {}
    await sleep(500);
  }
  if (revisar.length) console.log(`  [apps] bajones recientes: ${bajones} de ${revisar.length} apps bien valoradas revisadas`);
  // Primero los bajones recientes (señal activa) y luego las que más usuarios descontentos tienen.
  const dolor = (a) => (5 - a.nota) * Math.log(a.valoraciones);
  return [...porId.values()].sort((a, b) => Boolean(b.bajon) - Boolean(a.bajon) || dolor(b) - dolor(a));
}
