# lead-ops · Radar de leads B2B con Claude

**lead-ops** encuentra cada día empresas que tienen ahora mismo una razón para comprar lo que vendes. Las investiga a fondo con Claude y te deja cada lead con:
- su ficha de llamada;
- su correo en frío ya escrito;
- un CSV listo para importar en tu CRM.

Las tareas programadas de Claude Code se encargan de lo demás: importar los leads, dejar los borradores, enviar los correos y programar las llamadas, a tu hora.

Nació para un comercial que vende servicios de desarrollo y producto de apps en España. Todo lo propio del negocio (oferta, precios, perfiles de cliente, sectores, estilo de los correos) está en un archivo de configuración, así que puedes adaptarlo a casi cualquier venta B2B.

> *English: lead-ops is a daily B2B lead radar built on Claude. It finds companies with a fresh buying signal (e.g. a badly rated customer app, a hiring post, an expansion), researches each one with web search, discards the ones that don't fit or can't pay, and writes a call sheet plus a cold email for every lead, ready to import into your CRM. Prompts and docs are in Spanish; everything business-specific lives in `config/`.*

## Cómo funciona

```
Fuentes gratuitas ─┐
  · App Store: apps con nota baja pero vivas      ┌─ criba (Claude, sin búsquedas):
  · RSS de rondas de financiación                 │  elige los más prometedores
Búsqueda con IA ───┤  (Claude + búsqueda web)     │
  · un encargo por sector, con filtros duros      ├─ investigación a fondo, varias en paralelo:
                   └─> candidatos ─> exclusión ───┘  señal, tamaño y capacidad de pago,
                       (tu CRM, ya vistos)           decisor, contacto público, calor 1-5
                                                     y correo en frío escrito
                                                            │
                     output/AAAA-MM-DD/  <──────────────────┘
                     leads.json · leads-crm.csv · fichas.md · resumen.json (coste)
```

Las ideas de fondo:
- **Buscar gratis y usar la IA para pensar.** Las fuentes gratuitas traen volumen y Claude decide qué merece la pena.
- **Filtros duros desde el principio.** Tamaño, capacidad de pago, sin equipo propio, no ser competencia: cada candidato que no encaja cuesta una investigación.
- **Todos empiezan por correo; solo los mejores se llaman.** Cada lead que encaja lleva su correo. Los de calor 4-5 llevan además `merece_llamada`, y solo a esos merece la pena conseguirles el móvil.
- **Los ficheros son la fuente de verdad.** Lo investigado queda en `data/vistos.json` y no se repite. La exclusión (`data/excluir.txt`) reconoce nombres parecidos («Hospitales X: Cita Online» → «Hospitales X»).
- **El sistema prepara y la persona decide.** El radar no contacta a nadie; enviar es un paso aparte que activas tú.

## Requisitos
- Node.js 20 o superior.
- Una clave de la API de Anthropic (`ANTHROPIC_API_KEY`) o `ant auth login`.
- Opcional, para automatizarlo todo: [Claude Code](https://claude.com/claude-code) con Claude in Chrome (tareas programadas que trabajan en tu navegador, con tu sesión del CRM y del webmail).

## Puesta en marcha
```bash
npm ci
cp config/ejemplo.json config/config.json   # y adáptalo a tu empresa
cp data/excluir.ejemplo.txt data/excluir.txt
npm run prueba                               # solo fuentes gratuitas: no gasta nada
node radar.mjs --max 3                       # investiga 3 candidatos (prueba barata)
npm run radar                                # ejecución normal
```

## Configuración (`config/config.json`)
| Bloque | Para qué |
|---|---|
| `empresa` | Quién eres, qué vendes, cómo vendes, el nombre del comercial y el gancho gratuito («un análisis gratis de su app»). |
| `capacidadPago` | El mínimo que tiene que poder pagar un cliente. Es el primer filtro. |
| `perfiles` | Tus segmentos de cliente (se usan también como segmento del CRM). |
| `reglasDescarte` | Lo que nunca es un lead (competencia, multinacionales, abandonados…). |
| `descubrimiento` | El filtro duro y un encargo por sector para la búsqueda con IA. |
| `criba` | Lo que mejor y peor te ha funcionado. Actualízalo con lo que aprendas. |
| `estilo`, `correo` | Cómo hablas: apertura de la llamada, oferta y reglas del correo. |
| `busquedasApps`, `filtroApps`, `fuentesRondas` | Las fuentes gratuitas. |
| Volumen y coste | `candidatosAEvaluar`, `investigacionesEnParalelo`, `correosPorDia`, `llamadasPorDia`, `presupuestoDiario` (tope de gasto en $), `modelo`, `esfuerzo`. |

## Coste
Cada empresa investigada a fondo cuesta unos **0,30-0,40 $** con Claude Opus y búsqueda web (precios de lista). Un día típico de 40-60 empresas investigadas sale por 15-25 $. El radar se para solo al llegar a `presupuestoDiario` y deja el coste de cada ejecución en `resumen.json`. La criba previa y una lista de exclusión bien cuidada son lo que más baja el coste por lead útil.

## Automatizarlo con Claude Code
En `prompts/` hay dos plantillas para tareas programadas:
- **`rutina-crm.md`**, cada mañana:
  - ejecuta o recoge el radar;
  - importa el CSV en el CRM;
  - pone nota y próxima acción en cada lead, abriendo cada ficha por URL en un iframe oculto, sin clicar filas;
  - deja los borradores en el webmail;
  - prepara los seguimientos y reparte las llamadas.
- **`envio-correos.md`**, a una hora de oficina, solo si lo activas:
  - envía uno a uno los correos y seguimientos de ese día, y solo esos;
  - después programa las llamadas de los que lo merecen.

Copia tus versiones a `privado/` (no se sube a git), rellena los `{{…}}` con tus URL y nombres, y prográmalas desde Claude Code.

## Ejecutarlo en la nube con el repo público (datos cifrados)
Si quieres que el radar corra en la nube (una rutina programada de Claude Code o GitHub Actions) y que tu ordenador recoja los resultados, lo privado tiene que viajar por el repo. Para eso está `cifrado.mjs`:

```bash
node cifrado.mjs clave     # una vez: crea la clave en ~/.config/lead-ops/clave (guárdala también en tu gestor de contraseñas)
npm run cifrar             # empaqueta config/config.json, data/, privado/ y los últimos 14 días de output/ en privado.enc
npm run descifrar          # lo devuelve a su sitio
```

- `privado.enc` usa AES-256-GCM. La clave no va nunca al repo: en la nube va en la variable `LEAD_OPS_CLAVE` y en tu ordenador en `~/.config/lead-ops/clave`.
- El flujo es siempre el mismo: `git pull`, descifrar, trabajar, cifrar, commit solo de `privado.enc` y push.
- `privado/archivo/` no entra en el paquete: es lo que solo quieres tener en local.
- Tienes un ejemplo para GitHub Actions en `ejemplos/github-actions.yml`. En un repo público los registros de Actions son públicos, así que ahí el radar se lanza sin salida.
- Ojo: si algún día se filtra la clave, se puede leer todo `privado.enc` que haya en el historial. Cámbiala de vez en cuando con una clave nueva.

## Privacidad: qué se queda en tu ordenador
El `.gitignore` deja fuera de git todo lo privado:
- `config/config.json`: tu oferta, precios y clientes;
- `output/`: leads reales con nombres, emails y teléfonos;
- `data/`: tu CRM, lo ya investigado y la lista de exclusión;
- `privado/`: rutinas con URL internas, dossiers.

Si haces un fork, no lo quites. Y no subas leads a un repo público.

## Uso responsable
- **Datos personales.** El radar solo busca datos de contacto públicos de empresas (web, aviso legal) y nunca deduce emails personales. Aun así, nombres y cargos de decisores son datos personales (RGPD): guárdalos solo en tu CRM y bórralos si te lo piden.
- **Correo comercial.** En España, la LSSI (art. 21) limita los correos comerciales no solicitados, también entre empresas. Infórmate o consulta con quien lleve lo legal en tu empresa antes de automatizar envíos. Escribe siempre con datos reales, una propuesta concreta y una forma fácil de decir «no, gracias».
- **Revisa antes de enviar**, sobre todo al principio: el radar se equivoca a veces (empresa de un grupo grande, decisor desactualizado).

## Créditos
Inspirado en [career-ops](https://github.com/career-ops-hq/career-ops) (MIT, © 2026 Santiago Fernández de Valderrama): fuentes gratuitas, IA para evaluar, ficheros como fuente de verdad y la persona siempre al mando.

## Licencia
MIT, ver [LICENSE](LICENSE).
