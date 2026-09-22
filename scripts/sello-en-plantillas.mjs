// © 2026 Adrián Barroso de Cabo.
// Cambia el sello de TEMPS que viene YA DIBUJADO dentro de algunas plantillas.
//
// POR QUÉ HACE FALTA
// En la mayoría de los documentos especiales el sello lo pega la web al generarlos, así que basta
// con cambiar recursos/sello-temps.jpeg. Pero hay tres plantillas (CEPSA ANEXO 24, CUN MADRID e
// IESE MADRID) que traen el sello incrustado de fábrica, del escaneo antiguo: el que tenía un
// recuadro gris de fondo que se nota sobre el papel. Este script lo sustituye por la foto nueva.
//
// CÓMO LO HACE
// Un PDF guarda cada imagen como un objeto aparte con sus bytes (aquí, un JPEG) y una ficha que
// dice cuánto mide y en qué formato está. La foto nueva tiene exactamente el mismo tamaño
// (371 x 275) y el mismo formato (JPEG de color, 8 bits), así que basta con cambiar los bytes y
// dejar la ficha como estaba: todo lo demás del documento se queda igual, en su sitio.
//
// Se ejecuta a mano cuando cambie el sello:  node scripts/sello-en-plantillas.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDict, PDFName, PDFRawStream, abrirPdf, comoNombre, comoNumero, guardar, obtener, resolver } from "../js/pdfbase.js";

const SELLO = "recursos/sello-temps.jpeg";
// Las plantillas que traen el sello dentro. Se busca por tamaño, no por nombre del objeto, para
// que siga funcionando si algún día se regenera la plantilla y el objeto se llama de otra forma.
const PLANTILLAS = ["plantillas/cepsa-anexo-24.pdf", "plantillas/cun-madrid.pdf", "plantillas/iese-madrid.pdf"];
const ANCHO = 371;
const ALTO = 275;

const nuevo = new Uint8Array(readFileSync(SELLO));
let total = 0;

for (const ruta of PLANTILLAS) {
  const doc = await abrirPdf(new Uint8Array(readFileSync(ruta)));
  let cambiadas = 0;

  for (const pagina of doc.getPages()) {
    const recursos = resolver(doc, pagina.node.get(PDFName.of("Resources")));
    const xobjs = recursos instanceof PDFDict ? resolver(doc, obtener(doc, recursos, "XObject")) : null;
    if (!(xobjs instanceof PDFDict)) continue;

    for (const [, valor] of xobjs.entries()) {
      const imagen = resolver(doc, valor);
      if (!(imagen instanceof PDFRawStream)) continue;
      if (comoNombre(obtener(doc, imagen.dict, "Subtype")) !== "Image") continue;
      if (comoNumero(obtener(doc, imagen.dict, "Width")) !== ANCHO) continue;
      if (comoNumero(obtener(doc, imagen.dict, "Height")) !== ALTO) continue;
      if (comoNombre(obtener(doc, imagen.dict, "Filter")) !== "DCTDecode") continue;

      // Los bytes del JPEG viven en el propio objeto: se cambian en su sitio y se corrige el
      // tamaño declarado, que es lo único de la ficha que depende de los bytes.
      imagen.contents = nuevo;
      imagen.dict.set(PDFName.of("Length"), doc.context.obj(nuevo.length));
      cambiadas++;
    }
  }

  if (!cambiadas) {
    console.log(`${ruta}: no lleva el sello dentro, no se toca`);
    continue;
  }
  writeFileSync(ruta, await guardar(doc));
  console.log(`${ruta}: ${cambiadas} sello(s) cambiado(s)`);
  total += cambiadas;
}

console.log(`\nTotal: ${total} sello(s) cambiado(s) por el de ${SELLO}`);
process.exit(0);
