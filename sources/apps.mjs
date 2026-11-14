// Fuente gratuita (sin tokens): apps con nota baja pero vivas, vía la API pública de búsqueda de App Store.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Grandes tecnológicas y formas societarias de otros países: no son nuestro cliente.
const GRANDES_O_EXTRANJERAS = /\b(apple|google|microsoft|amazon|meta|samsung|inc\.?|llc|ltd\.?|limited|gmbh|s\.r\.l\.?|srl|b\.v\.?|sas|s\.a\.s|pty|dominican[oa]|m[eé]xico|colombia|argentina|chile|per[uú])\b/i;

const CATEGORIAS_FUERA = new Set(["Games", "Juegos", "Finance", "Finanzas", "News", "Noticias", "Reference", "Consulta", "Book", "Libros", "Developer Tools"]);

export async function fetchApps(config, isExcluded) {
  const { notaMaxima, valoracionesMinimas, mesesMaxSinActualizar } = config.filtroApps;
  const limiteFecha = Date.now() - mesesMaxSinActualizar * 30 * 864e5;
  const porId = new Map();

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
        if (nota > notaMaxima || valoraciones < valoracionesMinimas) continue;
        if (actualizada.getTime() < limiteFecha) continue; // abandonada
        if (valoraciones > (config.filtroApps.valoracionesMaximas ?? 20000)) continue; // demasiado grande: suele tener equipo propio
        if (GRANDES_O_EXTRANJERAS.test(a.sellerName ?? "")) continue;
        if (CATEGORIAS_FUERA.has(a.primaryGenreName)) continue; // juegos, bancos, prensa, diccionarios: no son nuestro cliente
        if (isExcluded(a.sellerName, a.trackName, a.sellerUrl)) continue;
        porId.set(a.trackId, {
          fuente: "app",
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
  // Primero las que más usuarios descontentos tienen.
  return [...porId.values()].sort((a, b) => (5 - b.nota) * Math.log(b.valoraciones) - (5 - a.nota) * Math.log(a.valoraciones));
}
