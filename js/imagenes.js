// © 2026 Adrián Barroso de Cabo.
// Imágenes en memoria: leer PNG y JPG (capturas de la firma), recortar el blanco sobrante y
// guardarlas en PNG o BMP. Una imagen es { ancho, alto, datos } con los píxeles en RGBA.

import { codificarPng, convertIndexedToRgb, decodificarJpeg, decodificarPng } from "../vendor/imagenes/imagenes.min.js";

const esPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const esJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/** Lee una imagen (PNG o JPG; en el navegador, cualquier formato que entienda). */
export async function decodificar(bytes) {
  const datos = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (esPng(datos)) return desdePng(decodificarPng(datos));
  if (esJpeg(datos)) {
    const jpg = decodificarJpeg(datos, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { ancho: jpg.width, alto: jpg.height, datos: new Uint8ClampedArray(jpg.data.buffer, jpg.data.byteOffset, jpg.data.length) };
  }
  if (typeof createImageBitmap === "function") {
    // BMP, GIF, WebP…: los lee el propio navegador
    const mapa = await createImageBitmap(new Blob([datos]));
    const lienzo = new OffscreenCanvas(mapa.width, mapa.height);
    const contexto = lienzo.getContext("2d");
    contexto.drawImage(mapa, 0, 0);
    const { data } = contexto.getImageData(0, 0, mapa.width, mapa.height);
    return { ancho: mapa.width, alto: mapa.height, datos: data };
  }
  throw new Error("formato de imagen no reconocido");
}

function desdePng(png) {
  let { data, channels, depth } = png;
  if (png.palette) {
    data = convertIndexedToRgb(png);
    channels = png.palette[0]?.length === 4 || png.transparency ? 4 : 3;
    depth = 8;
    if (data.length === png.width * png.height * 3) channels = 3;
    else if (data.length === png.width * png.height * 4) channels = 4;
  }
  const total = png.width * png.height;
  const rgba = new Uint8ClampedArray(total * 4);
  const valor = depth === 16 ? (v) => v >> 8 : depth < 8 ? (v) => Math.round((v * 255) / ((1 << depth) - 1)) : (v) => v;
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const d = i * 4;
    if (channels >= 3) {
      rgba[d] = valor(data[o]);
      rgba[d + 1] = valor(data[o + 1]);
      rgba[d + 2] = valor(data[o + 2]);
      rgba[d + 3] = channels === 4 ? valor(data[o + 3]) : 255;
    } else {
      const g = valor(data[o]);
      rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
      rgba[d + 3] = channels === 2 ? valor(data[o + 1]) : 255;
    }
  }
  // Transparencia de un color concreto (tRNS sin paleta)
  if (!png.palette && png.transparency && channels < 4 && channels !== 2) {
    const t = png.transparency;
    for (let i = 0; i < total; i++) {
      const d = i * 4;
      const coincide = channels >= 3
        ? data[i * channels] === t[0] && data[i * channels + 1] === t[1] && data[i * channels + 2] === t[2]
        : data[i * channels] === t[0];
      if (coincide) rgba[d + 3] = 0;
    }
  }
  return { ancho: png.width, alto: png.height, datos: rgba };
}

/** La imagen sobre fondo blanco (sin transparencias). */
export function aplanarSobreBlanco(imagen) {
  const d = new Uint8ClampedArray(imagen.datos);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    const f = a / 255;
    d[i] = Math.round(d[i] * f + 255 * (1 - f));
    d[i + 1] = Math.round(d[i + 1] * f + 255 * (1 - f));
    d[i + 2] = Math.round(d[i + 2] * f + 255 * (1 - f));
    d[i + 3] = 255;
  }
  return { ancho: imagen.ancho, alto: imagen.alto, datos: d };
}

/** Caja [x0, y0, x1, y1] (en píxeles) de lo que no es blanco, o null si está en blanco. */
export function cajaConTinta(imagen) {
  const { ancho, alto, datos } = imagen;
  let minX = ancho;
  let maxX = -1;
  let minY = -1;
  let maxY = -1;
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho * 4;
    let primero = -1;
    let ultimo = -1;
    for (let x = 0; x < ancho; x++) {
      const i = fila + x * 4;
      if (datos[i] < 200 || datos[i + 1] < 200 || datos[i + 2] < 200) {
        if (primero < 0) primero = x;
        ultimo = x;
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
  return [minX, minY, maxX + 1, maxY + 1];
}

/** El trozo [x0, y0, x1, y1] de la imagen. */
export function recortar(imagen, [x0, y0, x1, y1]) {
  const ancho = x1 - x0;
  const alto = y1 - y0;
  const datos = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    const desde = ((y0 + y) * imagen.ancho + x0) * 4;
    datos.set(imagen.datos.subarray(desde, desde + ancho * 4), y * ancho * 4);
  }
  return { ancho, alto, datos };
}

/** PNG en color (RGB, sin transparencia). */
export function png(imagen) {
  const { ancho, alto, datos } = imagen;
  const rgb = new Uint8Array(ancho * alto * 3);
  for (let i = 0, j = 0; i < datos.length; i += 4, j += 3) {
    rgb[j] = datos[i];
    rgb[j + 1] = datos[i + 1];
    rgb[j + 2] = datos[i + 2];
  }
  return codificarPng({ width: ancho, height: alto, data: rgb, channels: 3, depth: 8 });
}

/**
 * BMP de 24 bits (filas de arriba abajo). Para las vistas previas: no hay que comprimirlo, así que
 * se genera casi al instante y el navegador lo muestra igual que un PNG.
 */
export function bmp(imagen) {
  const { ancho, alto, datos } = imagen;
  const fila = (ancho * 3 + 3) & ~3; // cada fila ocupa un múltiplo de 4 bytes
  const cabecera = 54;
  const bytes = new Uint8Array(cabecera + fila * alto);
  const vista = new DataView(bytes.buffer);
  bytes[0] = 0x42; // "BM"
  bytes[1] = 0x4d;
  vista.setUint32(2, bytes.length, true);
  vista.setUint32(10, cabecera, true);
  vista.setUint32(14, 40, true); // BITMAPINFOHEADER
  vista.setInt32(18, ancho, true);
  vista.setInt32(22, -alto, true); // negativo: la primera fila es la de arriba
  vista.setUint16(26, 1, true);
  vista.setUint16(28, 24, true);
  for (let y = 0; y < alto; y++) {
    let origen = y * ancho * 4;
    let destino = cabecera + y * fila;
    for (let x = 0; x < ancho; x++, origen += 4, destino += 3) {
      bytes[destino] = datos[origen + 2]; // el BMP guarda azul, verde, rojo
      bytes[destino + 1] = datos[origen + 1];
      bytes[destino + 2] = datos[origen];
    }
  }
  return bytes;
}

/**
 * Datos de un PNG para meterlo en un PDF sin volver a comprimirlo: los PDF admiten directamente
 * los datos comprimidos del PNG (IDAT). Devuelve null si el PNG no es de un tipo que se pueda así
 * (con transparencia, entrelazado…).
 */
export function pngParaPdf(bytes) {
  if (!esPng(bytes)) return null;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  let cabecera = null;
  const idat = [];
  while (i + 8 <= bytes.length) {
    const longitud = vista.getUint32(i);
    const tipo = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const datos = bytes.subarray(i + 8, i + 8 + longitud);
    if (tipo === "IHDR") {
      cabecera = { ancho: vista.getUint32(i + 8), alto: vista.getUint32(i + 12), profundidad: datos[8], tipoColor: datos[9], entrelazado: datos[12] };
    } else if (tipo === "IDAT") idat.push(datos);
    else if (tipo === "tRNS" || tipo === "PLTE") return null;
    else if (tipo === "IEND") break;
    i += 12 + longitud;
  }
  if (!cabecera || cabecera.entrelazado || cabecera.profundidad !== 8) return null;
  const colores = { 0: 1, 2: 3 }[cabecera.tipoColor];
  if (!colores) return null; // con canal alfa o con paleta: no
  const total = idat.reduce((n, p) => n + p.length, 0);
  const comprimido = new Uint8Array(total);
  let k = 0;
  for (const parte of idat) {
    comprimido.set(parte, k);
    k += parte.length;
  }
  return { ancho: cabecera.ancho, alto: cabecera.alto, colores, comprimido };
}
