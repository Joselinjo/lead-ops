// Reseñas recientes de App Store y Google Play (gratis, sin tokens ni dependencias).
// Sirve para dos cosas:
//   1. Saber si una app está consolidada (muchas valoraciones = negocio que ya funciona y puede pagar).
//   2. Detectar un dolor reciente con pruebas: una versión nueva que dispara las quejas, o lo que más
//      se repite en las reseñas de 1-2 estrellas del último mes.
// App Store: API pública de búsqueda + feed RSS de reseñas (las más recientes, con su versión).
// Google Play: ficha pública (datos estructurados) + el mismo servicio que usa la web para listar reseñas.
import { norm } from "./store.mjs";

const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dominioDe = (u = "") => norm(u).split("/")[0];
const coincideDominio = (url, dominio) => {
  const a = dominioDe(url), b = dominioDe(dominio);
  if (!a || !b) return false;
  const base = (d) => d.split(".").slice(-2).join(".");
  return a === b || base(a) === base(b);
};
const coincideNombre = (a = "", b = "") => {
  const x = norm(a).replace(/\b(s\.?l\.?u?|s\.?a\.?u?|sociedad limitada|espana|spain|app)\b/g, "").replace(/\s+/g, " ").trim();
  const y = norm(b).replace(/\b(s\.?l\.?u?|s\.?a\.?u?|sociedad limitada|espana|spain|app)\b/g, "").replace(/\s+/g, " ").trim();
  return x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x));
};
async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ---------- App Store ----------
export async function buscarAppIOS({ nombre, dominio, iosId }, pais = "es") {
  if (iosId) {
    const { results = [] } = await getJSON(`https://itunes.apple.com/lookup?id=${iosId}&country=${pais}`);
    return results[0] ? fichaIOS(results[0]) : null;
  }
  if (!nombre) return null;
  const { results = [] } = await getJSON(`https://itunes.apple.com/search?country=${pais}&entity=software&limit=15&term=${encodeURIComponent(nombre)}`);
  const a = results.find((x) => dominio && coincideDominio(x.sellerUrl, dominio))
    ?? results.find((x) => coincideNombre(x.sellerName, nombre) || coincideNombre(x.artistName, nombre))
    ?? results.find((x) => coincideNombre(x.trackName, nombre)); // la app se llama como la marca aunque la empresa tenga otro nombre
  return a ? fichaIOS(a) : null;
}
const fichaIOS = (a) => ({
  tienda: "App Store", id: a.trackId, app: a.trackName, desarrollador: a.sellerName, web: a.sellerUrl ?? "",
  nota: a.averageUserRating ?? null, valoraciones: a.userRatingCount ?? 0,
  version: a.version, versionFecha: (a.currentVersionReleaseDate ?? "").slice(0, 10), url: a.trackViewUrl,
});

export async function resenasIOS(id, pais = "es", paginas = 4) {
  const out = [];
  for (let p = 1; p <= paginas; p++) {
    try {
      const d = await getJSON(`https://itunes.apple.com/${pais}/rss/customerreviews/page=${p}/id=${id}/sortby=mostrecent/json`);
      const e = d?.feed?.entry ?? [];
      const lista = Array.isArray(e) ? e : [e];
      for (const x of lista) {
        if (!x?.["im:rating"]) continue;
        out.push({ fecha: (x.updated?.label ?? "").slice(0, 10), nota: Number(x["im:rating"].label), version: x["im:version"]?.label ?? "", texto: `${x.title?.label ?? ""}. ${x.content?.label ?? ""}`.trim() });
      }
      if (lista.length < 50) break;
    } catch { break; }
    await sleep(400);
  }
  return out;
}

// ---------- Google Play ----------
async function fichaPlay(appId) {
  const h = await getText(`https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=es&gl=es`);
  const ld = [...h.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).find((x) => x?.["@type"] === "SoftwareApplication");
  if (!ld) return null;
  return {
    tienda: "Google Play", id: appId, app: ld.name, desarrollador: ld.author?.name ?? "", web: ld.author?.url ?? "",
    nota: ld.aggregateRating ? Number(ld.aggregateRating.ratingValue) : null, valoraciones: Number(ld.aggregateRating?.ratingCount ?? 0),
    version: "", versionFecha: "", url: `https://play.google.com/store/apps/details?id=${appId}`,
  };
}

// desarrolladorIOS: si ya sabemos quién publica la app en App Store, en Play se exige el mismo
// desarrollador cuando solo coincide el nombre de la app (evita apps de otros con nombre parecido).
export async function buscarAppAndroid({ nombre, dominio, androidId, desarrolladorIOS }) {
  if (androidId) return fichaPlay(androidId);
  if (!nombre) return null;
  const h = await getText(`https://play.google.com/store/search?q=${encodeURIComponent(nombre)}&c=apps&hl=es&gl=es`);
  const ids = [...new Set([...h.matchAll(/details\?id=([a-zA-Z0-9._]+)/g)].map((m) => m[1]))].slice(0, 6);
  for (const id of ids) {
    const f = await fichaPlay(id).catch(() => null);
    const vale = f && f.valoraciones > 0 && (
      (dominio && coincideDominio(f.web, dominio)) || coincideNombre(f.desarrollador, nombre) ||
      (desarrolladorIOS ? coincideNombre(f.desarrollador, desarrolladorIOS) : coincideNombre(f.app, nombre)));
    if (vale) return f;
    await sleep(300);
  }
  return null;
}

export async function resenasAndroid(appId, cuantas = 200) {
  const freq = JSON.stringify([[["UsvDTd", JSON.stringify([null, null, [2, 2, [cuantas, null, null], null, []], [appId, 7]]), null, "generic"]]]);
  const t = await getText("https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=UsvDTd&hl=es&gl=es", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "f.req=" + encodeURIComponent(freq),
  });
  const linea = t.split("\n").find((l) => l.startsWith("[["));
  if (!linea) return [];
  const crudo = JSON.parse(linea)?.[0]?.[2];
  if (!crudo) return [];
  return (JSON.parse(crudo)?.[0] ?? []).map((x) => ({
    fecha: x?.[5]?.[0] ? new Date(x[5][0] * 1000).toISOString().slice(0, 10) : "",
    nota: Number(x?.[2] ?? 0), version: x?.[10] ?? "", texto: String(x?.[4] ?? ""),
  })).filter((r) => r.nota);
}

// ---------- Análisis ----------
const media = (xs) => (xs.length ? xs.reduce((s, r) => s + r.nota, 0) / xs.length : null);
const pctNeg = (xs) => (xs.length ? xs.filter((r) => r.nota <= 2).length / xs.length : null);
const cmpVersion = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

export function analizar(resenas, { dias = 90, minResenas = 8, umbralNegativas = 0.4 } = {}) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const recientes = resenas.filter((r) => r.fecha >= desde);
  const anteriores = resenas.filter((r) => r.fecha < desde);
  const porVersion = Object.entries(resenas.filter((r) => r.version).reduce((g, r) => ((g[r.version] ??= []).push(r), g), {}))
    .map(([version, xs]) => ({ version, n: xs.length, media: media(xs), negativas: pctNeg(xs), desde: xs.map((r) => r.fecha).sort()[0] }))
    .filter((v) => v.n >= 3).sort((a, b) => cmpVersion(b.version, a.version)).slice(0, 3);
  const [ultima, previa] = porVersion;
  const mediaRec = media(recientes), mediaAnt = media(anteriores), negRec = pctNeg(recientes);
  const caidaVersion = ultima && previa && ultima.n >= 5 && ultima.media <= previa.media - 1;
  const caidaPeriodo = mediaRec != null && mediaAnt != null && anteriores.length >= 10 && mediaRec <= mediaAnt - 0.7;
  // pico = las quejas han ido a más hace poco (señal activa de verdad); constantes = la app lleva tiempo
  // mal y sigue recibiendo quejas (dolor real, pero no es noticia: hay que buscar el ángulo).
  const bastantes = recientes.length >= minResenas && negRec >= umbralNegativas;
  const pico = bastantes && Boolean(caidaVersion || caidaPeriodo);
  const constantes = bastantes && !pico;
  const quejas = recientes.filter((r) => r.nota <= 2 && r.texto.length > 25)
    .sort((a, b) => b.texto.length - a.texto.length).slice(0, 8)
    .map((r) => `${r.fecha} · ${r.nota}★ · v${r.version || "?"}: ${r.texto.replace(/\s+/g, " ").slice(0, 220)}`);
  return { muestra: resenas.length, recientes: recientes.length, mediaRecientes: mediaRec, negativasRecientes: negRec, mediaAnteriores: mediaAnt, porVersion, caidaVersion: Boolean(caidaVersion), caidaPeriodo, pico, constantes, quejas };
}

const f1 = (x) => (x == null ? "—" : x.toFixed(1).replace(".", ","));
const pc = (x) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const miles = (n) => Number(n || 0).toLocaleString("es-ES");

function textoTienda(f, a, dias) {
  if (!f) return "";
  let t = `- ${f.tienda} «${f.app}» (${f.desarrollador}): ${f1(f.nota)}★ con ${miles(f.valoraciones)} valoraciones${f.version ? `; versión ${f.version} ${f.versionAprox ? `(con reseñas desde el ${f.versionFecha})` : `del ${f.versionFecha}`}` : ""}. ${f.url}\n`;
  if (!a?.muestra) return t + "  Sin reseñas legibles.\n";
  t += `  Últimos ${dias} días: ${a.recientes} reseñas, media ${f1(a.mediaRecientes)}★, ${pc(a.negativasRecientes)} de 1-2★ (antes: ${f1(a.mediaAnteriores)}★).`;
  if (a.porVersion.length) t += ` Por versión: ${a.porVersion.map((v) => `${v.version} → ${v.n} reseñas, ${f1(v.media)}★, ${pc(v.negativas)} de 1-2★ (desde ${v.desde})`).join("; ")}.`;
  if (a.pico) t += ` ⚠️ PICO DE QUEJAS${a.caidaVersion ? " tras la última versión" : " en este periodo"}: han ido a más.`;
  else if (a.constantes) t += ` Quejas constantes: lleva tiempo mal y sigue igual (no es un cambio reciente).`;
  if (a.quejas.length) t += `\n  Quejas recientes (1-2★):\n${a.quejas.map((q) => `    · ${q}`).join("\n")}`;
  return t + "\n";
}

// Radiografía de las dos tiendas para una empresa. Devuelve null si no tiene app en ninguna.
export async function radiografiaTiendas({ nombre, dominio, iosId, androidId }, config = {}) {
  const opc = config.resenas ?? {};
  const dias = opc.dias ?? 90;
  const pais = config.tiendaApps?.pais ?? "es";
  const ios = await buscarAppIOS({ nombre, dominio, iosId }, pais).catch(() => null);
  const android = await buscarAppAndroid({ nombre, dominio, androidId, desarrolladorIOS: ios?.desarrollador }).catch(() => null);
  if (!ios && !android) return null;
  const [rIos, rAnd] = await Promise.all([
    ios ? resenasIOS(ios.id, pais).catch(() => []) : [],
    android ? resenasAndroid(android.id).catch(() => []) : [],
  ]);
  if (android && !android.version && rAnd.length) {
    const ult = [...rAnd].filter((r) => r.version).sort((a, b) => cmpVersion(b.version, a.version))[0];
    if (ult) android.version = ult.version, android.versionFecha = rAnd.filter((r) => r.version === ult.version).map((r) => r.fecha).sort()[0], android.versionAprox = true;
  }
  const aIos = ios ? analizar(rIos, opc) : null;
  const aAnd = android ? analizar(rAnd, opc) : null;
  const valoraciones = (ios?.valoraciones ?? 0) + (android?.valoraciones ?? 0);
  const consolidada = valoraciones >= (opc.valoracionesMinimas ?? 500);
  const pico = Boolean(aIos?.pico || aAnd?.pico);
  const constantes = !pico && Boolean(aIos?.constantes || aAnd?.constantes);
  const texto = textoTienda(ios, aIos, dias) + textoTienda(android, aAnd, dias) +
    `- Total: ${miles(valoraciones)} valoraciones entre las dos tiendas → ${consolidada ? "app consolidada (negocio que ya funciona)" : `app pequeña (menos de ${miles(opc.valoracionesMinimas ?? 500)} valoraciones): por sí sola no prueba que puedan pagar`}.`;
  const partes = [ios && `App Store ${f1(ios.nota)}★ (${miles(ios.valoraciones)})`, android && `Google Play ${f1(android.nota)}★ (${miles(android.valoraciones)})`].filter(Boolean);
  const peor = [aIos && { t: "App Store", a: aIos }, aAnd && { t: "Google Play", a: aAnd }].filter(Boolean).filter((x) => x.a.pico)
    .map((x) => `${x.t}: ${pc(x.a.negativasRecientes)} de 1-2★ en ${dias} días${x.a.caidaVersion ? ` desde la versión ${x.a.porVersion[0].version}` : ""} (antes ${f1(x.a.mediaAnteriores)}★)`);
  const constante = [aIos && { t: "App Store", a: aIos }, aAnd && { t: "Google Play", a: aAnd }].filter(Boolean).filter((x) => x.a.constantes)
    .map((x) => `${x.t}: ${pc(x.a.negativasRecientes)} de 1-2★ en ${dias} días`);
  const resumen = `Reseñas: ${partes.join(" · ")}${peor.length ? ` · PICO DE QUEJAS → ${peor.join("; ")}` : constante.length ? ` · quejas constantes → ${constante.join("; ")}` : ""}.`;
  return { ios, android, analisis: { ios: aIos, android: aAnd }, valoraciones, consolidada, pico, constantes, texto, resumen };
}
