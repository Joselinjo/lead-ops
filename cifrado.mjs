// Datos privados cifrados dentro del repo (para que el repo pueda ser público y el radar siga
// corriendo en la nube). Empaqueta lo privado en un único archivo, privado.enc, cifrado con
// AES-256-GCM. La clave NUNCA va al repo: está en la variable LEAD_OPS_CLAVE (la nube) o en
// ~/.config/lead-ops/clave (tu ordenador).
//
//   node cifrado.mjs clave       crea una clave nueva en ~/.config/lead-ops/clave (una vez)
//   node cifrado.mjs cifrar      empaqueta y cifra lo privado en privado.enc
//   node cifrado.mjs descifrar   descifra privado.enc y lo deja en su sitio
//
// Qué entra en el paquete: config/config.json, data/, privado/ (salvo privado/archivo/, que se queda
// solo en local) y los últimos LEAD_OPS_DIAS días de output/ (14 por defecto).
// Flujo: git pull → descifrar → trabajar → cifrar → commit de privado.enc → push.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(ROOT, "privado.enc");
const FICHERO_CLAVE = join(homedir(), ".config", "lead-ops", "clave");
const CABECERA = Buffer.from("LOPS1");

function clave() {
  const b64 = process.env.LEAD_OPS_CLAVE?.trim() || (existsSync(FICHERO_CLAVE) ? readFileSync(FICHERO_CLAVE, "utf8").trim() : "");
  if (!b64) throw new Error(`Falta la clave: define LEAD_OPS_CLAVE o crea ${FICHERO_CLAVE} con «node cifrado.mjs clave».`);
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("La clave tiene que ser de 32 bytes en base64.");
  return k;
}

function rutasDelPaquete() {
  const dias = Number(process.env.LEAD_OPS_DIAS ?? 14);
  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const rutas = ["config/config.json", "data", "privado"].filter((r) => existsSync(join(ROOT, r)));
  const out = join(ROOT, "output");
  if (existsSync(out)) for (const d of readdirSync(out)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= desde) rutas.push(`output/${d}`);
  return rutas;
}

function tar(args, input) {
  // COPYFILE_DISABLE evita que el tar de macOS meta archivos «._*» de metadatos en el paquete.
  const r = spawnSync("tar", args, { cwd: ROOT, input, maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (r.status !== 0) throw new Error(`tar falló: ${r.stderr?.toString()}`);
  return r.stdout;
}

const accion = process.argv[2];
if (accion === "clave") {
  if (existsSync(FICHERO_CLAVE)) throw new Error(`Ya existe ${FICHERO_CLAVE}: no la sobrescribo.`);
  mkdirSync(dirname(FICHERO_CLAVE), { recursive: true });
  writeFileSync(FICHERO_CLAVE, randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
  chmodSync(FICHERO_CLAVE, 0o600);
  console.log(`Clave creada en ${FICHERO_CLAVE}. Guárdala también en tu gestor de contraseñas y, para la nube, en la variable LEAD_OPS_CLAVE.`);
} else if (accion === "cifrar") {
  const k = clave();
  const rutas = rutasDelPaquete();
  const paquete = tar(["-czf", "-", "--exclude", "privado/archivo", "--exclude", ".DS_Store", "--exclude", "._*", ...rutas]);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const cifrado = Buffer.concat([c.update(paquete), c.final()]);
  writeFileSync(ARCHIVO, Buffer.concat([CABECERA, iv, c.getAuthTag(), cifrado]));
  console.log(`privado.enc: ${rutas.length} rutas, ${(paquete.length / 1024).toFixed(0)} KB comprimidos.`);
} else if (accion === "descifrar") {
  if (!existsSync(ARCHIVO)) { console.log("No hay privado.enc: nada que descifrar."); process.exit(0); }
  const buf = readFileSync(ARCHIVO);
  if (!buf.subarray(0, 5).equals(CABECERA)) throw new Error("privado.enc no tiene el formato esperado.");
  const iv = buf.subarray(5, 17), tag = buf.subarray(17, 33), datos = buf.subarray(33);
  const d = createDecipheriv("aes-256-gcm", clave(), iv);
  d.setAuthTag(tag);
  const paquete = Buffer.concat([d.update(datos), d.final()]);
  tar(["-xzf", "-"], paquete);
  console.log(`privado.enc descifrado (${(paquete.length / 1024).toFixed(0)} KB).`);
} else {
  console.log("Uso: node cifrado.mjs clave | cifrar | descifrar");
  process.exit(1);
}
