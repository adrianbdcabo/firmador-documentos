// Utilidades comunes sobre MuPDF.js: abrir y guardar PDFs, añadir contenido y recortar renders.

import * as mupdf from "../vendor/mupdf/mupdf.js";

export { mupdf };

export class ErrorProcesado extends Error {
  // Error con un mensaje pensado para mostrárselo al usuario.
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorProcesado";
  }
}

export class FirmaNoEncontrada extends ErrorProcesado {
  constructor(mensaje) {
    super(mensaje);
    this.name = "FirmaNoEncontrada";
  }
}

const RGB = mupdf.ColorSpace.DeviceRGB;

export function abrirPdf(datos) {
  let doc;
  try {
    doc = new mupdf.PDFDocument(datos instanceof Uint8Array ? datos : new Uint8Array(datos));
    if (doc.needsPassword()) throw new ErrorProcesado("El PDF está protegido con contraseña.");
    if (doc.countPages() === 0) throw new Error("sin páginas");
  } catch (error) {
    if (error instanceof ErrorProcesado) throw error;
    throw new ErrorProcesado("El archivo no es un PDF válido o está dañado.");
  }
  return doc;
}

export function guardar(doc) {
  const buffer = doc.saveToBuffer("garbage=3,compress");
  try {
    return buffer.asUint8Array().slice(); // copia: la memoria de MuPDF se libera después
  } finally {
    buffer.destroy();
  }
}

export function textoPagina(pagina) {
  const texto = pagina.toStructuredText("preserve-whitespace");
  try {
    return texto.asText();
  } finally {
    texto.destroy();
  }
}

export function rectDeQuad(q) {
  return [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];
}

/** Líneas de texto de la página, con cada carácter, su fuente, tamaño, color y posición. */
export function lineasDeTexto(pagina) {
  const lineas = [];
  let actual = null;
  const texto = pagina.toStructuredText("preserve-whitespace");
  texto.walk({
    beginLine(bbox) {
      actual = { bbox, chars: [] };
    },
    onChar(c, origin, font, size, quad, color) {
      actual?.chars.push({ c, origen: origin, rect: rectDeQuad(quad), fuente: font.getName(), tamano: size, color });
    },
    endLine() {
      if (actual) lineas.push(actual);
      actual = null;
    },
  });
  texto.destroy();
  return lineas;
}

/** Nombre de una fuente sin el prefijo de subconjunto ("TJMWDI+ArialNarrow" -> "ArialNarrow"). */
export function nombreBase(nombre) {
  return nombre.includes("+") ? nombre.slice(nombre.indexOf("+") + 1) : nombre;
}

export function aPdf(pagina, [x, y]) {
  const m = mupdf.Matrix.invert(pagina.getTransform());
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

export function numero(valor) {
  return Math.abs(valor) < 1e-9 ? "0" : String(+valor.toFixed(4));
}

/** Añade `ref` a los recursos de la página con un nombre libre y lo devuelve. */
export function anadirRecurso(doc, objetoPagina, tipo, prefijo, ref) {
  if (objetoPagina.get("Resources").isNull()) {
    const copia = doc.newDictionary();
    const heredados = objetoPagina.getInheritable("Resources");
    if (!heredados.isNull()) heredados.resolve().forEach((valor, clave) => copia.put(clave, valor));
    objetoPagina.put("Resources", copia);
  }
  const recursos = objetoPagina.get("Resources").resolve();
  if (recursos.get(tipo).isNull()) recursos.put(tipo, doc.newDictionary());
  const grupo = recursos.get(tipo).resolve();
  let n = 0;
  while (!grupo.get(`${prefijo}${n}`).isNull()) n++;
  grupo.put(`${prefijo}${n}`, ref);
  return `${prefijo}${n}`;
}

/** Añade operadores al final de la página, con el contenido anterior aislado entre q/Q. */
export function anadirContenido(doc, objetoPagina, operadores) {
  const actual = objetoPagina.get("Contents");
  const lista = doc.newArray();
  lista.push(doc.addStream("q\n", {}));
  const resuelto = actual.resolve();
  if (resuelto.isArray()) resuelto.forEach((parte) => lista.push(parte));
  else if (!actual.isNull()) lista.push(actual);
  lista.push(doc.addStream(`\nQ\n${operadores}\n`, {}));
  objetoPagina.put("Contents", lista);
}

/** Caja [x0, y0, x1, y1] (en píxeles del pixmap) de lo que no es blanco, o null si está en blanco. */
export function cajaConTinta(pix) {
  const ancho = pix.getWidth();
  const alto = pix.getHeight();
  const paso = pix.getStride();
  const componentes = paso / ancho;
  const canales = Math.min(componentes, 3);
  const datos = pix.getPixels();
  let minX = ancho;
  let maxX = -1;
  let minY = -1;
  let maxY = -1;
  for (let y = 0; y < alto; y++) {
    const fila = y * paso;
    let primero = -1;
    let ultimo = -1;
    for (let x = 0; x < ancho; x++) {
      const i = fila + x * componentes;
      for (let k = 0; k < canales; k++) {
        if (datos[i + k] < 200) {
          if (primero < 0) primero = x;
          ultimo = x;
          break;
        }
      }
    }
    if (primero >= 0) {
      minX = Math.min(minX, primero);
      maxX = Math.max(maxX, ultimo);
      if (minY < 0) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x = pix.getX();
  const y = pix.getY();
  return [minX + x, minY + y, maxX + 1 + x, maxY + 1 + y];
}

/** PNG de lo que dibuja `ejecutar(dispositivo, matriz)`, sobre blanco, solo dentro de `caja` (píxeles). */
export function renderRecorte(ejecutar, matriz, caja) {
  const pix = new mupdf.Pixmap(RGB, caja.map(Math.round), false);
  pix.clear(255);
  const dispositivo = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  try {
    ejecutar(dispositivo, matriz);
    dispositivo.close();
    return pix.asPNG().slice();
  } finally {
    dispositivo.destroy();
    pix.destroy();
  }
}

export function miniatura(datosPdf, anchoPx) {
  const doc = new mupdf.PDFDocument(datosPdf);
  const pagina = doc.loadPage(0);
  const [x0, , x1] = pagina.getBounds();
  const zoom = anchoPx / (x1 - x0);
  const pix = pagina.toPixmap(mupdf.Matrix.scale(zoom, zoom), RGB, false, true);
  try {
    return pix.asPNG().slice();
  } finally {
    pix.destroy();
    pagina.destroy();
    doc.destroy();
  }
}
