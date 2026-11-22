// Radiografía de reseñas de una empresa en App Store y Google Play (gratis, sin tokens).
//   npm run resenas -- "Nombre de la empresa" [dominio.com]
//   npm run resenas -- --ios 123456789 --android com.empresa.app
import { loadConfig } from "./lib/store.mjs";
import { radiografiaTiendas } from "./lib/resenas.mjs";

const a = process.argv.slice(2);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const libres = a.filter((x, i) => !x.startsWith("--") && !a[i - 1]?.startsWith("--"));
const [nombre, dominio] = libres;
if (!nombre && !opt("--ios") && !opt("--android")) {
  console.error('Uso: npm run resenas -- "Nombre" [dominio.com]   o   --ios <id> --android <paquete>');
  process.exit(1);
}
const r = await radiografiaTiendas({ nombre, dominio, iosId: opt("--ios"), androidId: opt("--android") }, loadConfig());
if (!r) { console.log(`No encuentro app de «${nombre}» en ninguna tienda.`); process.exit(0); }
if (a.includes("--json")) console.log(JSON.stringify(r, null, 2));
else console.log(`${r.resumen}\n\n${r.texto}`);
