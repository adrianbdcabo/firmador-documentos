// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/siegfried-el-masnou.pdf: la plantilla en blanco de SIEGFRIED EL MASNOU con las
// respuestas del cuestionario (hoja 2) ya marcadas, exactamente como en el documento de ejemplo.
//
// POR QUÉ HACE FALTA
// El cuestionario lleva siempre las mismas respuestas, así que en vez de pegarlas cada vez se dejan
// dentro de la plantilla. En el ejemplo las X son la misma imagen (150 x 117, de 12 x 9,36 puntos)
// puesta once veces, y la de la pregunta 1 son dos trazos de 2 puntos: aquí se copia esa imagen
// tal cual y se repiten las mismas posiciones y los mismos trazos, sin redibujar nada.
//
// Se ejecuta a mano:  node scripts/plantilla-siegfried.mjs PLANTILLA.pdf HECHO.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDict, PDFName, PDFRawStream, PDFDocument, anadirContenido, anadirRecurso, guardar, obtener } from "../js/pdfbase.js";

const [plantilla, hecho] = process.argv.slice(2);
if (!plantilla || !hecho) throw new Error("uso: node scripts/plantilla-siegfried.mjs PLANTILLA.pdf HECHO.pdf");

// La imagen de la X, tal y como está en el ejemplo (objeto /X0 de la hoja 2)
const docHecho = await PDFDocument.load(new Uint8Array(readFileSync(hecho)));
const objetosHecho = docHecho.getPage(1).node.Resources().lookup(PDFName.of("XObject"), PDFDict);
const imagenX = docHecho.context.lookup(objetosHecho.get(PDFName.of("X0")));

const doc = await PDFDocument.load(new Uint8Array(readFileSync(plantilla)), { updateMetadata: false });
const pagina = doc.getPage(1);
const dict = doc.context.obj({ Type: "XObject", Subtype: "Image" });
for (const clave of ["Width", "Height", "ColorSpace", "BitsPerComponent", "Filter"]) {
  dict.set(PDFName.of(clave), obtener(docHecho, imagenX, clave));
}
const recurso = anadirRecurso(doc, pagina, "XObject", "XRespuesta", doc.context.register(PDFRawStream.of(dict, imagenX.contents)));

// Esquina de abajo a la izquierda de cada X (origen abajo a la izquierda), leída del ejemplo
const POSICIONES = [
  [76.151, 447.33], [77.476, 362.55], [77.476, 251.27], [85.866, 194.75], [86.308, 145.73],
  [86.749, 114.38], [243.07, 197.4], [243.95, 145.29], [402.48, 196.95], [400.28, 143.96], [401.6, 113.94],
];
const operadores = POSICIONES.map(([x, y]) => `q 12 0 0 9.36 ${x} ${y} cm /${recurso} Do Q`);

// La X de la pregunta 1: dos trazos negros de 2 puntos (las coordenadas ya llevan el cambio de eje del ejemplo)
operadores.push(
  "q 0 G 2.010493 w 0 J 0 j 78.125 564.117 m 87.156 557.16 l S Q",
  "q 0 G 1.990517 w 0 J 0 j 78.019 557.343 m 86.375 563.566 l S Q",
);
anadirContenido(doc, pagina, operadores.join("\n"));

writeFileSync("plantillas/siegfried-el-masnou.pdf", await guardar(doc));
console.log("plantillas/siegfried-el-masnou.pdf");
process.exit(0);
