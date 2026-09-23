// © 2026 Adrián Barroso de Cabo.
// Crea plantillas/epis-antiguos.pdf a partir del registro de entrega de EPI ya relleno.
//
// POR QUÉ HACE FALTA
// De este impreso no hay plantilla en blanco, solo un documento hecho con los datos de una
// trabajadora de verdad. La plantilla se descarga desde el navegador, así que no puede llevar
// dentro el nombre ni el DNI de nadie. Este script le quita todo lo que se rellena (nombre,
// apellidos, DNI, las fechas de la tabla, las X de las casillas, la fecha del pie y la firma) y
// deja el impreso vacío, que es lo que rellena luego la web.
//
// Se ejecuta a mano cuando cambie el documento de ejemplo:
//   node scripts/plantilla-epis.mjs "C:\ruta\EPI ANTIGUO HECHO.pdf"
import { readFileSync, writeFileSync } from "node:fs";
import { quitarGlifos } from "../js/fecha.js";
import { interpretar, lineasDeGlifos } from "../js/lector.js";
import { PDFName, PDFRawStream, abrirPdf, cambiarContenido, guardar, obtener, resolver } from "../js/pdfbase.js";

const ORIGEN = process.argv[2] ?? "tmp-ta2/epi-antiguo.pdf";
const DESTINO = "plantillas/epis-antiguos.pdf";

// La tabla de los EPI va entre estas dos alturas: dentro de ella se borran las fechas y las X.
const TABLA = [300, 455];
// El hueco donde va la firma del trabajador, para reconocer su imagen y quitarla.
const FIRMA = [31, 737.8, 157.8, 786.5];

const doc = await abrirPdf(new Uint8Array(readFileSync(ORIGEN)));
const pagina = doc.getPage(0);
const lectura = interpretar(doc, pagina);
const lineas = lineasDeGlifos(lectura.glifos);
const borrar = new Set();
const quitado = [];

/** Marca para borrar las letras de `trozo` dentro de una línea. */
function borrarTrozo(linea, trozo) {
  const texto = linea.chars.map((ch) => ch.c).join("");
  const desde = texto.indexOf(trozo);
  if (desde < 0) return false;
  for (const ch of linea.chars.slice(desde, desde + trozo.length)) if (ch.glifo) borrar.add(ch.glifo);
  quitado.push(trozo);
  return true;
}

for (const linea of lineas) {
  const texto = linea.chars.map((ch) => ch.c).join("");
  const limpio = texto.trim();
  const primero = linea.chars.find((ch) => ch.glifo);
  if (!primero) continue;
  const y = primero.glifo.origen[1];

  // La fila de arriba: "Trabajador/a NOMBRE Apellidos APELLIDOS". El nombre va entre el rótulo
  // "Trabajador/a" y el rótulo "Apellidos", y los apellidos, detrás de este último.
  const cabecera = /^Trabajador\/a\s+(?<nombre>.+?)\s+Apellidos\s+(?<apellidos>.+)$/.exec(limpio);
  if (cabecera) {
    borrarTrozo(linea, cabecera.groups.nombre);
    borrarTrozo(linea, cabecera.groups.apellidos);
    continue;
  }
  // El DNI, que va él solo en su casilla.
  if (/^[0-9A-Z]{8,10}$/.test(limpio) && y < TABLA[0]) {
    borrarTrozo(linea, limpio);
    continue;
  }
  // Dentro de la tabla: las diez fechas y las diez X de las casillas.
  if (y > TABLA[0] && y < TABLA[1] && (/^\d{2}\/\d{2}\/\d{4}$/.test(limpio) || limpio === "X")) {
    borrarTrozo(linea, limpio);
    continue;
  }
  // La fecha del pie, "En MADRID a 2 3 de SEPTIEMBRE de 2026", que la web vuelve a escribir entera.
  if (/^En\s+\S+\s+a\s/.test(limpio)) borrarTrozo(linea, limpio);
}

cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));

// La firma del trabajador es una imagen. Se deja el dibujo en su sitio pero con un solo punto
// blanco dentro: así desaparece sin tocar el resto de las órdenes de dibujo de la página.
const xobjs = resolver(doc, obtener(doc, resolver(doc, pagina.node.get(PDFName.of("Resources"))), "XObject"));
let firmas = 0;
for (const imagen of interpretar(doc, pagina).imagenes) {
  const [x0, y0, x1, y1] = imagen.rect ?? [];
  if (Math.abs(x0 - FIRMA[0]) > 2 || Math.abs(y0 - FIRMA[1]) > 2 || Math.abs(x1 - FIRMA[2]) > 2 || Math.abs(y1 - FIRMA[3]) > 2) continue;
  // El nombre viene sin la barra de delante ("Image28"), así que se busca la entrada a mano.
  const entrada = [...xobjs.entries()].find(([clave]) => clave.asString().replace("/", "") === String(imagen.nombre));
  const objeto = entrada ? resolver(doc, entrada[1]) : null;
  if (!(objeto instanceof PDFRawStream)) continue;
  objeto.contents = new Uint8Array([255, 255, 255]); // un punto blanco, sin comprimir
  objeto.dict.delete(PDFName.of("Filter"));
  objeto.dict.delete(PDFName.of("SMask"));
  objeto.dict.delete(PDFName.of("DecodeParms"));
  objeto.dict.set(PDFName.of("Width"), doc.context.obj(1));
  objeto.dict.set(PDFName.of("Height"), doc.context.obj(1));
  objeto.dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  objeto.dict.set(PDFName.of("BitsPerComponent"), doc.context.obj(8));
  objeto.dict.set(PDFName.of("Length"), doc.context.obj(3));
  firmas++;
}

writeFileSync(DESTINO, await guardar(doc));
console.log(`${DESTINO}: quitados ${quitado.length} datos (${quitado.join(", ")}) y ${firmas} firma(s)`);
process.exit(0);
