// © 2026 Adrián Barroso de Cabo. Licencia AGPL-3.0 (ver LICENSE).
// Copia a dist/ solo los archivos de la web (sin node_modules, pruebas ni configuración),
// que es lo que se publica en Cloudflare con `npm run deploy`.
import fs from "node:fs";

const ARCHIVOS = ["index.html", "css", "js", "vendor", "plantillas", "recursos", "icono.svg", "LICENSE"];

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist");
for (const archivo of ARCHIVOS) fs.cpSync(archivo, `dist/${archivo}`, { recursive: true });
console.log(`dist/ preparada con: ${ARCHIVOS.join(", ")}`);
