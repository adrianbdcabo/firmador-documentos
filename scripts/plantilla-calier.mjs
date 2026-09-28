// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/calier.pdf a partir del impreso en blanco de CALIER.
//
// POR QUÉ HACE FALTA
// El impreso en blanco ya viene sin datos de nadie, pero está guardado desde Word, que deja la
// Calibri con los dibujos de las letras que no usa borrados (scripts/completar-fuentes.mjs lo
// explica). En el impreso en blanco apenas hay mayúsculas, así que casi cualquier nombre saldría
// con letras que la plantilla no sabe dibujar. Este script le pone la Calibri completa; los huecos
// de puntos se dejan como están, porque es lo que busca js/calier.js para saber dónde escribir.
//
// Se ejecuta a mano cuando cambie el impreso:
//   node scripts/plantilla-calier.mjs "C:\ruta\DOCU ESPECIAL CALIER PLANTILLA.pdf"
import { readFileSync, writeFileSync } from "node:fs";
import { generarCalier } from "../js/calier.js";
import { completarFuentes } from "./completar-fuentes.mjs";
import { abrirPdf, guardar } from "../js/pdfbase.js";

const ORIGEN = process.argv[2] ?? "tmp-ta2/calier-plantilla.pdf";
const DESTINO = "plantillas/calier.pdf";

// Solo hace falta la normal: la frase del nombre y la fecha van en Calibri sin negrita.
const FUENTES = { Calibri: "C:/Windows/Fonts/calibri.ttf" };

const doc = await abrirPdf(new Uint8Array(readFileSync(ORIGEN)));
if (!completarFuentes(doc, FUENTES)) throw new Error("no se ha completado ninguna fuente: revisa el documento de origen");
const pdf = await guardar(doc);

// Una prueba de que la plantilla sirve: se rellena con datos inventados y se tira el resultado.
await generarCalier(pdf, { trabajador: "NOMBRE Y APELLIDOS DEL TRABAJADOR", fecha: new Date(2026, 0, 1) });

writeFileSync(DESTINO, pdf);
console.log(`${DESTINO}: plantilla creada a partir de ${ORIGEN} (${(pdf.length / 1024).toFixed(0)} kB)`);
process.exit(0);
