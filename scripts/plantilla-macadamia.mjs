// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/macadamia.pdf a partir del documento de ejemplo ya relleno.
//
// POR QUÉ HACE FALTA
// De MACADAMIA no hay plantilla en blanco, solo un documento hecho con los datos de un trabajador
// de verdad. Ese documento no se puede subir a la web tal cual: la plantilla se descarga desde el
// navegador, así que el nombre y el DNI de esa persona quedarían a la vista de cualquiera.
//
// LAS DOS COSAS QUE HACE ESTE SCRIPT
//  1. Completa las fuentes. Word, al guardar el PDF, mete la Calibri entera pero con los dibujos
//     de las letras que el documento no usa borrados. Como el nombre del trabajador va en negrita,
//     de la Calibri negrita solo quedan las letras de "JHON JAIRO CARVAJAL VERGARA": cualquier otro
//     nombre saldría con medio abecedario en otra letra. Así que se cambian las dos fuentes del
//     documento por la Calibri de verdad de Windows, recortada a las letras que pueden hacer falta
//     (unas 200, las de WinAnsi), y se rehace su tabla de anchuras.
//  2. Escribe en el hueco del nombre y del DNI unos datos inventados, pasando el documento por el
//     mismo relleno que usa la web (js/macadamia.js). Así la plantilla no lleva dentro ningún dato
//     personal y además está compuesta exactamente igual que lo que va a generar la web después.
//
// SOBRE LA FUENTE
// La Calibri de Windows permite incrustarse en documentos (su permiso de incrustación es el de
// "edición"), que es justo lo que ya venía haciendo el Word con el que se hizo el original.
//
// Se ejecuta a mano cuando cambie el documento de ejemplo:
//   node scripts/plantilla-macadamia.mjs "C:\ruta\DOCU ESPECIAL MACADAMIA HECHO.pdf"
import { readFileSync, writeFileSync } from "node:fs";
import { generarMacadamia } from "../js/macadamia.js";
import { recortarFuente } from "./subconjunto-ttf.mjs";
import {
  PDFDict, PDFName, PDFRawStream, abrirPdf, comoNombre, guardar, heredado, letraWinAnsi, nombreBase, obtener, resolver,
} from "../js/pdfbase.js";

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

// Las letras que se dejan dentro de la fuente: todas las de WinAnsi, que es la codificación con la
// que el documento escribe. Así vale cualquier nombre, con tildes, eñes o lo que haga falta.
const LETRAS = [];
for (let codigo = 32; codigo < 256; codigo++) {
  const letra = letraWinAnsi(codigo);
  if (letra) LETRAS.push({ codigo, letra });
}

const doc = await abrirPdf(new Uint8Array(readFileSync(ORIGEN)));
const fuentes = obtener(doc, heredado(doc, doc.getPage(0).node, "Resources"), "Font");
let cambiadas = 0;

for (const [, valor] of fuentes.entries()) {
  const fuente = resolver(doc, valor);
  if (!(fuente instanceof PDFDict)) continue;
  const base = nombreBase(comoNombre(obtener(doc, fuente, "BaseFont")) ?? "");
  const ruta = FUENTES[base];
  if (!ruta) {
    console.log(`${base}: no hay copia completa de esta fuente, se deja como está`);
    continue;
  }

  const { fuente: recortada, anchuras } = recortarFuente(new Uint8Array(readFileSync(ruta)), LETRAS.map((l) => l.letra));

  // El dibujo de la fuente vive en /FontFile2, dentro del descriptor. Se cambian sus bytes y los
  // dos tamaños que dependen de ellos: /Length (lo que ocupa en el PDF) y /Length1 (la fuente).
  const descriptor = resolver(doc, obtener(doc, fuente, "FontDescriptor"));
  const archivo = resolver(doc, obtener(doc, descriptor, "FontFile2"));
  if (!(archivo instanceof PDFRawStream)) throw new Error(`${base}: la fuente no viene incrustada como se esperaba`);
  archivo.contents = recortada;
  archivo.dict.delete(PDFName.of("Filter")); // los bytes nuevos van sin comprimir
  archivo.dict.set(PDFName.of("Length"), doc.context.obj(recortada.length));
  archivo.dict.set(PDFName.of("Length1"), doc.context.obj(recortada.length));

  // Y la tabla de anchuras, que ahora tiene que cubrir todas las letras: el PDF la usa para
  // repartir el texto, así que si no coincide con la fuente las palabras se descolocan.
  fuente.set(PDFName.of("FirstChar"), doc.context.obj(32));
  fuente.set(PDFName.of("LastChar"), doc.context.obj(255));
  const anchos = [];
  for (let codigo = 32; codigo <= 255; codigo++) {
    const letra = letraWinAnsi(codigo);
    anchos.push(doc.context.obj(letra ? anchuras.get(letra) ?? 0 : 0));
  }
  fuente.set(PDFName.of("Widths"), doc.context.obj(anchos));
  console.log(`${base}: fuente completa (${(recortada.length / 1024).toFixed(0)} kB) y ${anchos.length} anchuras`);
  cambiadas++;
}

if (!cambiadas) throw new Error("no se ha completado ninguna fuente: revisa el documento de origen");

// Y ahora el relleno de siempre, con datos inventados.
const conFuentes = await guardar(doc);
const pdf = await generarMacadamia(conFuentes, { trabajador: NOMBRE, dni: DNI, fecha: FECHA });
writeFileSync(DESTINO, pdf);
console.log(`${DESTINO}: plantilla creada a partir de ${ORIGEN} (${(pdf.length / 1024).toFixed(0)} kB)`);
process.exit(0);
