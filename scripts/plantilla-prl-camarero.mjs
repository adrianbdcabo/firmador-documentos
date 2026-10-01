// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/prl-camarero.pdf a partir del diploma de PRL de camarero/a en blanco.
//
// POR QUÉ HACE FALTA
// El diploma en blanco que se exporta trae todavía el nombre, el DNI y la fecha de un trabajador
// anterior (BECERRA FERNANDEZ, CARLOS, 11898769H y 21/08/2023). No se ven, porque encima hay un
// rectángulo blanco, pero siguen escritos en el PDF: se podrían seleccionar y copiar, y se
// colarían en el diploma de cualquier otro trabajador. Aquí se quitan del contenido de la hoja.
//
// Se ejecuta a mano:  node scripts/plantilla-prl-camarero.mjs PLANTILLA.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { abrirPdf, cambiarContenido, contenidoPagina, guardar } from "../js/pdfbase.js";

const [origen] = process.argv.slice(2);
if (!origen) throw new Error("uso: node scripts/plantilla-prl-camarero.mjs PLANTILLA.pdf");

const doc = await abrirPdf(new Uint8Array(readFileSync(origen)));
const pagina = doc.getPage(0);
const contenido = Buffer.from(contenidoPagina(doc, pagina)).toString("latin1");

// Los tres textos viejos (nombre, DNI y fecha) van seguidos, justo detrás del logotipo y antes del
// rectángulo blanco que los tapa (la primera marca "/P <</MCID 4>>" ya es el fondo blanco).
const desde = contenido.search(/q\r?\n239\.06 440\.95 261\.02 19\.08 re/);
const hasta = contenido.indexOf(" /P <</MCID 4>>");
if (desde < 0 || hasta < desde) throw new Error("no se encuentran los datos del trabajador anterior");
const limpio = contenido.slice(0, desde) + contenido.slice(hasta);
for (const viejo of ["BECE", "11898769H", "21/08/2023"]) if (limpio.includes(viejo)) throw new Error(`sigue "${viejo}"`);

cambiarContenido(doc, pagina, Buffer.from(limpio, "latin1"));
writeFileSync("plantillas/prl-camarero.pdf", await guardar(doc));
console.log("plantillas/prl-camarero.pdf");
process.exit(0);
