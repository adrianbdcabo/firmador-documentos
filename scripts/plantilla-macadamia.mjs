// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/macadamia.pdf a partir del documento de ejemplo ya relleno.
//
// POR QUÉ HACE FALTA
// De MACADAMIA no hay plantilla en blanco, solo un documento hecho con los datos de un trabajador
// de verdad. Ese documento no se puede subir a la web tal cual: la plantilla se descarga desde el
// navegador, así que el nombre y el DNI de esa persona quedarían a la vista de cualquiera.
//
// LAS DOS COSAS QUE HACE ESTE SCRIPT
//  1. Completa las fuentes (scripts/completar-fuentes.mjs). Word deja incrustada la Calibri con los
//     dibujos de las letras que no usa borrados, y como el nombre del trabajador va en negrita, de
//     la Calibri negrita solo quedan las letras de "JHON JAIRO CARVAJAL VERGARA": cualquier otro
//     nombre saldría con medio abecedario en otra letra.
//  2. Escribe en el hueco del nombre y del DNI unos datos inventados, pasando el documento por el
//     mismo relleno que usa la web (js/macadamia.js). Así la plantilla no lleva dentro ningún dato
//     personal y además está compuesta exactamente igual que lo que va a generar la web después.
//
// Se ejecuta a mano cuando cambie el documento de ejemplo:
//   node scripts/plantilla-macadamia.mjs "C:\ruta\DOCU ESPECIAL MACADAMIA HECHO.pdf"
import { readFileSync, writeFileSync } from "node:fs";
import { generarMacadamia } from "../js/macadamia.js";
import { completarFuentes } from "./completar-fuentes.mjs";
import { abrirPdf, guardar } from "../js/pdfbase.js";

const ORIGEN = process.argv[2] ?? "tmp-ta2/macadamia-hecho.pdf";
const DESTINO = "plantillas/macadamia.pdf";

// La Calibri de Windows, por nombre de fuente del documento.
const FUENTES = {
  Calibri: "C:/Windows/Fonts/calibri.ttf",
  "Calibri-Bold": "C:/Windows/Fonts/calibrib.ttf",
};

// Datos de relleno que no son de nadie. El nombre va largo a propósito, para que la plantilla
// guarde el párrafo repartido en las mismas líneas que tendrá casi siempre.
const NOMBRE = "NOMBRE Y APELLIDOS DEL TRABAJADOR";
const DNI = "00000000A";
const FECHA = new Date(2026, 0, 1);

const doc = await abrirPdf(new Uint8Array(readFileSync(ORIGEN)));
const cambiadas = completarFuentes(doc, FUENTES);

if (!cambiadas) throw new Error("no se ha completado ninguna fuente: revisa el documento de origen");

// Y ahora el relleno de siempre, con datos inventados.
const conFuentes = await guardar(doc);
const pdf = await generarMacadamia(conFuentes, { trabajador: NOMBRE, dni: DNI, fecha: FECHA });
writeFileSync(DESTINO, pdf);
console.log(`${DESTINO}: plantilla creada a partir de ${ORIGEN} (${(pdf.length / 1024).toFixed(0)} kB)`);
process.exit(0);
