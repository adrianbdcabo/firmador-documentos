// © 2026 Adrián Barroso de Cabo.
// Base común sobre pdf-lib: abrir y guardar PDFs, leer objetos y streams, coordenadas de la página
// y añadir contenido (imágenes, fuentes, operadores) a una página.
//
// Coordenadas: como en toda la aplicación, en puntos con el origen arriba a la izquierda de la
// página visible (la "caja" de recorte), igual que se ve en pantalla. `transformacion(pagina)`
// pasa de las coordenadas internas del PDF a estas.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { pngParaPdf } from "./imagenes.js";

export { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString };

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

const nombre = (texto) => PDFName.of(texto);

/** Abre un PDF con pdf-lib o lanza un ErrorProcesado con un mensaje para el usuario. */
export async function abrirPdf(datos) {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    if (error?.name === "EncryptedPDFError" || /encrypted/i.test(error?.message ?? "")) {
      throw new ErrorProcesado("El PDF está protegido con contraseña.");
    }
    throw new ErrorProcesado("El archivo no es un PDF válido o está dañado.");
  }
  if (doc.isEncrypted) throw new ErrorProcesado("El PDF está protegido con contraseña.");
  if (doc.getPageCount() === 0) throw new ErrorProcesado("El archivo no es un PDF válido o está dañado.");
  return doc;
}

/** Bytes del PDF. */
export async function guardar(doc) {
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

// ---------------------------------------------------------------- objetos

/** El objeto al que apunta `valor` (si es una referencia), o el propio valor. */
export function resolver(doc, valor) {
  return valor instanceof PDFRef ? doc.context.lookup(valor) : valor;
}

export function obtener(doc, dict, clave) {
  if (!dict) return undefined;
  const d = dict instanceof PDFStream ? dict.dict : dict;
  return resolver(doc, d.get(nombre(clave)));
}

export function comoNumero(valor) {
  return valor instanceof PDFNumber ? valor.asNumber() : undefined;
}

export function comoNombre(valor) {
  return valor instanceof PDFName ? valor.decodeText() : undefined;
}

export function comoArray(doc, valor) {
  const v = resolver(doc, valor);
  return v instanceof PDFArray ? v.asArray().map((x) => resolver(doc, x)) : undefined;
}

export function numeros(doc, valor) {
  return comoArray(doc, valor)?.map(comoNumero);
}

/** Bytes de un texto PDF (literal o hexadecimal). */
export function bytesDeTexto(valor) {
  if (valor instanceof PDFHexString || valor instanceof PDFString) return valor.asBytes();
  return undefined;
}

/** Contenido descomprimido de un stream. */
export function leerStream(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return stream.getContents();
}

/** Valor heredable de la página (Resources, MediaBox, CropBox, Rotate). */
export function heredado(doc, nodo, clave) {
  let actual = nodo;
  for (let n = 0; actual && n < 50; n++) {
    const valor = actual.get(nombre(clave));
    if (valor !== undefined) return resolver(doc, valor);
    actual = resolver(doc, actual.get(nombre("Parent")));
  }
  return undefined;
}

// ---------------------------------------------------------------- matrices y coordenadas

export const IDENTIDAD = [1, 0, 0, 1, 0, 0];

/** m1 seguida de m2 (como en PDF: primero se aplica m1). */
export function multiplicar(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function invertir(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [...IDENTIDAD];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function aplicar(m, [x, y]) {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

/** Caja [x0, y0, x1, y1] que ocupa el rectángulo `r` transformado por `m`. */
export function transformarRect(m, r) {
  const puntos = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map((p) => aplicar(m, p));
  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normalizarRect(r) {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** Caja visible de la página (CropBox dentro de MediaBox), en coordenadas del PDF. */
export function cajaPagina(doc, pagina) {
  const nodo = pagina.node;
  const media = normalizarRect(numeros(doc, heredado(doc, nodo, "MediaBox")) ?? [0, 0, 612, 792]);
  const recorte = numeros(doc, heredado(doc, nodo, "CropBox"));
  if (!recorte || recorte.length !== 4) return media;
  const c = normalizarRect(recorte);
  const caja = [Math.max(c[0], media[0]), Math.max(c[1], media[1]), Math.min(c[2], media[2]), Math.min(c[3], media[3])];
  return caja[2] > caja[0] && caja[3] > caja[1] ? caja : media;
}

function rotacion(doc, pagina) {
  const r = comoNumero(heredado(doc, pagina.node, "Rotate")) ?? 0;
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

/** Matriz de coordenadas del PDF a coordenadas de pantalla (origen arriba a la izquierda). */
export function transformacion(doc, pagina) {
  const caja = cajaPagina(doc, pagina);
  const base = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotacion(doc, pagina)];
  const m = [...base, 0, 0];
  const [x0, y0] = transformarRect(m, caja);
  m[4] = -x0;
  m[5] = -y0;
  return m;
}

/** Límites de la página en coordenadas de pantalla: [0, 0, ancho, alto]. */
export function limites(doc, pagina) {
  const caja = transformarRect(transformacion(doc, pagina), cajaPagina(doc, pagina));
  return [0, 0, caja[2] - caja[0], caja[3] - caja[1]];
}

/** De coordenadas de pantalla a coordenadas del PDF. */
export function aPdf(doc, pagina, punto) {
  return aplicar(invertir(transformacion(doc, pagina)), punto);
}

export function numero(valor) {
  return Math.abs(valor) < 1e-9 ? "0" : String(+valor.toFixed(4));
}

/** Nombre de una fuente sin el prefijo de subconjunto ("TJMWDI+ArialNarrow" -> "ArialNarrow"). */
export function nombreBase(texto) {
  return texto.includes("+") ? texto.slice(texto.indexOf("+") + 1) : texto;
}

// ---------------------------------------------------------------- modificar páginas

/** Diccionario de recursos propio de la página (si los heredaba, se copian a la página). */
function recursosPropios(doc, pagina) {
  const nodo = pagina.node;
  let recursos = resolver(doc, nodo.get(nombre("Resources")));
  if (!(recursos instanceof PDFDict)) {
    const heredados = heredado(doc, nodo, "Resources");
    recursos = heredados instanceof PDFDict ? heredados.clone(doc.context) : doc.context.obj({});
    nodo.set(nombre("Resources"), recursos);
  }
  return recursos;
}

/** Añade `valor` a los recursos de la página con un nombre libre y lo devuelve. */
export function anadirRecurso(doc, pagina, tipo, prefijo, valor) {
  const recursos = recursosPropios(doc, pagina);
  let grupo = resolver(doc, recursos.get(nombre(tipo)));
  if (!(grupo instanceof PDFDict)) {
    grupo = doc.context.obj({});
    recursos.set(nombre(tipo), grupo);
  } else if (recursos.get(nombre(tipo)) instanceof PDFRef) {
    // el grupo puede estar compartido con otras páginas: se usa una copia propia
    grupo = grupo.clone(doc.context);
    recursos.set(nombre(tipo), grupo);
  }
  let n = 0;
  while (grupo.has(nombre(`${prefijo}${n}`))) n++;
  grupo.set(nombre(`${prefijo}${n}`), valor);
  return `${prefijo}${n}`;
}

function streamDeTexto(doc, texto) {
  return doc.context.register(doc.context.flateStream(texto));
}

/** Añade operadores al final de la página, con el contenido anterior aislado entre q/Q. */
export function anadirContenido(doc, pagina, operadores) {
  const nodo = pagina.node;
  const actual = nodo.get(nombre("Contents"));
  const resuelto = resolver(doc, actual);
  const lista = [streamDeTexto(doc, "q\n")];
  if (resuelto instanceof PDFArray) lista.push(...resuelto.asArray());
  else if (actual) lista.push(actual);
  lista.push(streamDeTexto(doc, `\nQ\n${operadores}\n`));
  nodo.set(nombre("Contents"), doc.context.obj(lista));
}

/** Sustituye todo el contenido de la página por `bytes`. */
export function cambiarContenido(doc, pagina, bytes) {
  pagina.node.set(nombre("Contents"), doc.context.register(doc.context.flateStream(bytes)));
}

/**
 * Mete una imagen (PNG o JPG) en el documento y devuelve { ref, ancho, alto }. Los PNG normales
 * (sin transparencia) se meten tal cual, sin descomprimirlos ni volver a comprimirlos.
 */
export async function incrustarImagen(doc, bytes) {
  const png = pngParaPdf(bytes);
  if (png) {
    const stream = doc.context.flateStream(new Uint8Array(0), {
      Type: "XObject",
      Subtype: "Image",
      Width: png.ancho,
      Height: png.alto,
      ColorSpace: png.colores === 3 ? "DeviceRGB" : "DeviceGray",
      BitsPerComponent: 8,
      DecodeParms: { Predictor: 15, Colors: png.colores, BitsPerComponent: 8, Columns: png.ancho },
    });
    stream.contents = png.comprimido; // ya van comprimidos (y con los filtros de PNG, que el PDF entiende)
    return { ref: doc.context.register(stream), ancho: png.ancho, alto: png.alto };
  }
  const esJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const imagen = esJpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  return { ref: imagen.ref, ancho: imagen.width, alto: imagen.height };
}

/** Contenido de la página descomprimido (todos sus streams seguidos). */
export function contenidoPagina(doc, pagina) {
  const valor = resolver(doc, pagina.node.get(nombre("Contents")));
  const streams = valor instanceof PDFArray ? valor.asArray().map((v) => resolver(doc, v)) : valor ? [valor] : [];
  const partes = streams.filter((s) => s instanceof PDFStream).map((s) => leerStream(s));
  const total = partes.reduce((n, p) => n + p.length + 1, 0);
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const parte of partes) {
    bytes.set(parte, i);
    i += parte.length;
    bytes[i++] = 0x0a; // separador entre streams, como si fueran uno
  }
  return bytes;
}
