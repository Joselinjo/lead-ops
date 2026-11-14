// Persistencia en ficheros (como career-ops: los ficheros son la fuente de verdad).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "data");

// Tu configuración va en config/config.json (no se sube a git). Si no existe, se usa el ejemplo.
// También puedes indicar otra ruta con LEAD_OPS_CONFIG.
export function loadConfig() {
  const propia = process.env.LEAD_OPS_CONFIG ?? join(ROOT, "config", "config.json");
  const file = existsSync(propia) ? propia : join(ROOT, "config", "ejemplo.json");
  if (file.endsWith("ejemplo.json")) console.warn("  [config] usando config/ejemplo.json: copia el ejemplo a config/config.json y adáptalo a tu empresa.");
  return JSON.parse(readFileSync(file, "utf8"));
}

// Normaliza nombres y dominios para comparar sin acentos, mayúsculas ni "www.".
export function norm(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")
    .replace(/[^a-z0-9.]+/g, " ").trim();
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

// Exportación de Leads del CRM (CSV). Se usan todas las columnas de texto como posibles nombres/dominios.
function readCrmExport() {
  const file = join(DATA, "crm-leads.csv");
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
    for (const cell of line.split(/[;,]/)) {
      const c = cell.replace(/^"|"$/g, "").trim();
      if (c.length > 2 && !/^\+?\d[\d\s]+$/.test(c)) out.push(c);
    }
  }
  return out;
}

export function loadSeen() {
  const file = join(DATA, "vistos.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

export function saveSeen(seen) {
  writeFileSync(join(DATA, "vistos.json"), JSON.stringify(seen, null, 2));
}

// Devuelve una función que dice si una empresa (nombre o dominio) ya está excluida.
// Compara sin la forma societaria ni coletillas («S.L.», «España», «Grupo»…) y reconoce el nombre
// dentro de uno más largo («Clínicas Ejemplo: Cita Online» → Clínicas Ejemplo).
const COLETILLAS = /\b(s\.?l\.?u?|s\.?a\.?u?|s\.?coop\.?( v\.?)?|sociedad limitada|espana|spain|grupo|group|app|oficial)\b/g;
const limpia = (n) => n.replace(COLETILLAS, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function buildExcluder() {
  const keys = new Set();
  for (const s of [...readLines(join(DATA, "excluir.txt")), ...readCrmExport(), ...Object.keys(loadSeen())]) {
    const n = norm(s);
    if (n.length > 2) keys.add(n);
    const l = limpia(n);
    if (l.length > 2) keys.add(l);
  }
  // Para buscar dentro de nombres largos solo valen claves distintivas (6+ letras).
  const largas = [...keys].filter((k) => k.length >= 6 && !k.includes("."));
  return (...names) =>
    names.filter(Boolean).some((name) => {
      const n = norm(name);
      if (!n) return false;
      if (keys.has(n)) return true;
      const base = n.split(".")[0];
      if (base.length > 3 && keys.has(base)) return true;
      const l = limpia(n);
      if (keys.has(l)) return true;
      const conEspacios = ` ${l} `;
      return largas.some((k) => conEspacios.includes(` ${k} `));
    });
}

export function outputDir(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  const dir = join(ROOT, "output", d);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function csvEscape(v = "") {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
