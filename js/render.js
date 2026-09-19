// © 2026 Adrián Barroso de Cabo.
// Dibujar páginas de un PDF con pdf.js (las vistas previas y la "captura" de la firma digital).
// Devuelve la imagen en memoria: { ancho, alto, datos } con los píxeles en RGBA.

import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { bmp } from "./imagenes.js";

const CARPETA = new URL("../vendor/pdfjs/", import.meta.url);
const EN_NAVEGADOR = typeof window !== "undefined" && typeof document !== "undefined";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", CARPETA).href;

let trabajador = null; // un solo "worker" de pdf.js para todos los documentos
let rutas = null;

async function opciones() {
  if (!rutas) {
    if (EN_NAVEGADOR) {
      rutas = { standardFontDataUrl: new URL("standard_fonts/", CARPETA).href, wasmUrl: new URL("wasm/", CARPETA).href };
    } else {
      const { fileURLToPath } = await import("node:url");
      const carpeta = fileURLToPath(CARPETA).replace(/\\/g, "/");
      rutas = { standardFontDataUrl: `${carpeta}standard_fonts/`, wasmUrl: `${carpeta}wasm/` };
    }
  }
  trabajador ??= new pdfjs.PDFWorker({ verbosity: pdfjs.VerbosityLevel.ERRORS });
  return { ...rutas, worker: trabajador, verbosity: pdfjs.VerbosityLevel.ERRORS, isEvalSupported: false };
}

async function crearLienzo(ancho, alto) {
  if (EN_NAVEGADOR) {
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    return lienzo;
  }
  const { createCanvas } = await import("@napi-rs/canvas");
  return createCanvas(ancho, alto);
}

/**
 * Dibuja una página ya abierta por pdf.js. `superpuestas` son imágenes que se pegan encima
 * (la firma y el sello), con su sitio en puntos: { imagen, x, y, ancho, alto }.
 */
async function dibujar(pagina, { escala = 1, anchoPx = 0, anotaciones = true, superpuestas = [] }) {
  const vista = pagina.getViewport({ scale: anchoPx ? anchoPx / pagina.getViewport({ scale: 1 }).width : escala });
  const ancho = Math.max(1, Math.round(vista.width));
  const alto = Math.max(1, Math.round(vista.height));
  const lienzo = await crearLienzo(ancho, alto);
  const contexto = lienzo.getContext("2d", { willReadFrequently: true }); // se leen sus píxeles
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, ancho, alto);
  await pagina.render({
    canvas: EN_NAVEGADOR ? lienzo : null,
    canvasContext: contexto,
    viewport: vista,
    background: "#ffffff",
    annotationMode: anotaciones ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE,
  }).promise;
  for (const sitio of superpuestas) {
    const z = vista.scale;
    contexto.drawImage(sitio.imagen, sitio.x * z, sitio.y * z, sitio.ancho * z, sitio.alto * z);
  }
  const { data } = contexto.getImageData(0, 0, ancho, alto);
  pagina.cleanup();
  return { ancho, alto, datos: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Abre el PDF con pdf.js, hace `accion(documento)` y lo cierra. */
async function conDocumento(pdf, accion) {
  // pdf.js se queda con los bytes que se le pasan (los manda a su "worker"): se le da una copia
  const tarea = pdfjs.getDocument({ data: pdf.slice(), ...(await opciones()) });
  try {
    return await accion(await tarea.promise);
  } finally {
    await tarea.destroy();
  }
}

/**
 * Dibuja la página `indice` (desde 0) del PDF a `escala` píxeles por punto (o de `anchoPx` de
 * ancho), sobre blanco. Con `anotaciones: false` solo se dibuja el contenido de la página.
 */
export async function renderizar(pdf, { indice = 0, ...opcionesDibujo } = {}) {
  return conDocumento(pdf, async (documento) => dibujar(await documento.getPage(indice + 1), opcionesDibujo));
}

/** Imagen (BMP) de la primera página, de `anchoPx` píxeles de ancho, para la vista previa. */
export async function miniatura(pdf, anchoPx) {
  return bmp(await renderizar(pdf, { anchoPx }));
}

/**
 * Imágenes (BMP) de todas las páginas, de `anchoPx` de ancho. Se abre el documento una sola vez:
 * las páginas comparten fuentes e imágenes y así se preparan solo una vez.
 */
export async function miniaturas(pdf, anchoPx, superpuestas = []) {
  return conDocumento(pdf, (documento) =>
    Promise.all(Array.from({ length: documento.numPages }, async (_, i) =>
      bmp(await dibujar(await documento.getPage(i + 1), { anchoPx, superpuestas: superpuestas[i] ?? [] })))),
  );
}
