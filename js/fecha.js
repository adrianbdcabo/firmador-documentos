// Cambiar la fecha de "En COSLADA, a 16 de Septiembre de 2026" por otra con idéntica apariencia.
//
// La fecha se borra y se vuelve a escribir en la misma posición, tamaño y color con la MISMA
// fuente que ya trae el PDF, usando sus propios glifos: el resultado es idéntico al original.
// Los PDFs solo incluyen las letras que usan; si a la fuente le falta alguna (p. ej. el 7, la J o
// la z en la Arial Narrow de EPI), esa letra se toma de la versión normal de la fuente que también
// está en la hoja (Arial), estrechada a la anchura de la original. No hace falta ninguna fuente
// instalada en el ordenador.

import { anadirContenido, anadirRecurso, guardar, lineasDeTexto, mupdf, nombreBase, numero, aPdf } from "./pdfutil.js";

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const FECHA = /\d{1,2} de \p{L}+ de \d{4}/u;
const PARECIDAS = { ArialNarrow: "ArialMT", "ArialNarrow-Bold": "Arial-BoldMT" };

export class FechaNoCambiada extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "FechaNoCambiada";
  }
}

export function fechaDeHoy(hoy = new Date()) {
  return `${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;
}

/** Para cada fuente del documento: qué glifo y anchura usa para cada carácter. */
export function glifosDelDocumento(doc) {
  return recorrerTexto(doc).glifos;
}

/**
 * Una sola pasada por todo el documento que saca a la vez:
 * - `glifos`: para cada fuente, qué glifo y anchura usa para cada carácter (para escribir la fecha);
 * - `textos`: los caracteres de cada página en el orden en que se dibujan, sin espacios (para
 *   encontrar las hojas por su título).
 * Antes eran dos pasadas y era lo que más tardaba al cargar un documento.
 */
export function recorrerTexto(doc) {
  const glifos = {};
  // Se llama una vez por cada letra del documento: el nombre de la fuente se pide solo la primera
  // vez que aparece en cada página (pedirlo siempre era lo que más tardaba).
  let fuentesDeLaPagina = new Map();
  let caracteres = [];
  const leer = {
    showGlyph(_font, _trm, _glyph, unicode) {
      if (unicode > 32) caracteres.push(String.fromCodePoint(unicode));
    },
  };
  const recoger = {
    showGlyph(font, trm, glyph, unicode) {
      leer.showGlyph(font, trm, glyph, unicode);
      if (unicode < 32 || glyph <= 0) return;
      let mapa = fuentesDeLaPagina.get(font.pointer);
      if (!mapa) {
        mapa = glifos[nombreBase(font.getName())] ??= {};
        fuentesDeLaPagina.set(font.pointer, mapa);
      }
      const caracter = String.fromCodePoint(unicode);
      if (!(caracter in mapa)) mapa[caracter] = { gid: glyph, avance: font.advanceGlyph(glyph) };
    },
  };
  // Las letras solo se recogen del texto visible; el texto de la página incluye también el invisible.
  const soloLeer = (texto) => texto.walk(leer);
  const dispositivo = new mupdf.Device({
    fillText: (texto) => texto.walk(recoger),
    strokeText: soloLeer,
    clipText: soloLeer,
    clipStrokeText: soloLeer,
    ignoreText: soloLeer,
  });
  const textos = [];
  for (let i = 0; i < doc.countPages(); i++) {
    fuentesDeLaPagina = new Map();
    caracteres = [];
    const pagina = doc.loadPage(i);
    pagina.run(dispositivo, mupdf.Matrix.identity);
    pagina.destroy();
    textos.push(caracteres.join(""));
  }
  dispositivo.close();
  return { glifos, textos };
}

/** PDF (una hoja) con la fecha de la línea "En …" sustituida por `fecha`. */
export function cambiarFecha(pdf, fecha, glifos) {
  const doc = new mupdf.PDFDocument(pdf);
  try {
    const pagina = doc.loadPage(0);
    const linea = lineaConFecha(pagina);
    if (!linea) throw new FechaNoCambiada("no se ha encontrado la fecha en la hoja.");

    const primero = linea.chars[linea.inicio];
    const fuente = nombreBase(primero.fuente);
    // Lo que va detrás de la fecha (p. ej. el punto final) se reescribe con ella.
    const texto = fecha + linea.chars.slice(linea.fin).map((ch) => ch.c).join("").trimEnd();

    const principal = { ref: fuenteDeRecursos(pagina, fuente), mapa: glifos[fuente] ?? {} };
    if (!principal.ref) throw new FechaNoCambiada(`la fuente ${fuente} de la fecha no se puede reutilizar.`);
    const nombreParecida = PARECIDAS[fuente];
    const parecida = {
      ref: nombreParecida ? fuenteDeRecursos(pagina, nombreParecida) : null,
      mapa: (nombreParecida && glifos[nombreParecida]) || {},
    };
    const estrechar = proporcionAnchuras(principal.mapa, parecida.mapa);

    const tramos = [];
    for (const caracter of texto) {
      let origen = null;
      if (principal.mapa[caracter]) origen = principal;
      else if (parecida.ref && parecida.mapa[caracter]) origen = parecida;
      else throw new FechaNoCambiada(`a la fuente ${fuente} del PDF le falta el carácter «${caracter}».`);
      const gid = origen.mapa[caracter].gid.toString(16).padStart(4, "0");
      if (tramos.at(-1)?.origen === origen) tramos.at(-1).hex += gid;
      else tramos.push({ origen, hex: gid });
    }

    // Borrar la fecha original (solo su texto; imágenes y líneas quedan intactas).
    const anotacion = pagina.createAnnotation("Redact");
    anotacion.setRect([primero.rect[0] + 0.3, linea.bbox[1] + 1, linea.bbox[2] + 0.5, linea.bbox[3] - 1]);
    pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);

    // Escribirla de nuevo con los glifos del propio documento.
    const objetoPagina = pagina.getObject();
    const nombres = new Map();
    for (const tramo of tramos) {
      if (!nombres.has(tramo.origen)) nombres.set(tramo.origen, anadirRecurso(doc, objetoPagina, "Font", "FFecha", tramo.origen.ref));
    }
    const [x, y] = aPdf(pagina, primero.origen);
    const [r, g, b] = (primero.color?.length === 3 ? primero.color : [0, 0, 0]).map(numero);
    const operadores = [`q BT 0 Tc 0 Tw 0 Ts 0 Tr ${r} ${g} ${b} rg 1 0 0 1 ${numero(x)} ${numero(y)} Tm`];
    for (const tramo of tramos) {
      const escala = tramo.origen === principal ? 100 : estrechar * 100;
      operadores.push(`/${nombres.get(tramo.origen)} ${numero(primero.tamano)} Tf ${numero(escala)} Tz <${tramo.hex}> Tj`);
    }
    operadores.push("ET Q");
    anadirContenido(doc, objetoPagina, operadores.join(" "));
    return guardar(doc);
  } finally {
    doc.destroy();
  }
}

function lineaConFecha(pagina) {
  for (const linea of lineasDeTexto(pagina)) {
    const texto = linea.chars.map((ch) => ch.c).join("");
    if (!texto.trimStart().startsWith("En ")) continue;
    const coincidencia = FECHA.exec(texto);
    if (coincidencia) {
      // índices en caracteres (no en unidades UTF-16)
      const inicio = [...texto.slice(0, coincidencia.index)].length;
      return { ...linea, inicio, fin: inicio + [...coincidencia[0]].length };
    }
  }
  return null;
}

/** Referencia a la fuente `nombre` de la página si se puede escribir con ella por número de glifo. */
function fuenteDeRecursos(pagina, nombre) {
  const fuentes = pagina.getObject().getInheritable("Resources").resolve().get("Font").resolve();
  let encontrada = null;
  if (!fuentes.isDictionary()) return null;
  fuentes.forEach((ref) => {
    const fuente = ref.resolve();
    const base = fuente.get("BaseFont");
    if (encontrada || !base.isName() || nombreBase(base.asName()) !== nombre) return;
    const encoding = fuente.get("Encoding");
    if (fuente.get("Subtype").asName() !== "Type0" || !encoding.isName() || encoding.asName() !== "Identity-H") return;
    const descendiente = fuente.get("DescendantFonts").resolve().get(0).resolve();
    const mapa = descendiente.get("CIDToGIDMap");
    if (!mapa.isNull() && !(mapa.isName() && mapa.asName() === "Identity")) return;
    encontrada = ref;
  });
  return encontrada;
}

/** Cuánto más estrecha es la fuente de la fecha que la parecida (Arial Narrow frente a Arial ≈ 0,82). */
function proporcionAnchuras(mapa, mapaParecida) {
  const proporciones = Object.keys(mapa)
    .filter((c) => /[\p{L}\p{N}]/u.test(c) && mapaParecida[c] && mapa[c].avance && mapaParecida[c].avance)
    .map((c) => mapa[c].avance / mapaParecida[c].avance)
    .sort((a, b) => a - b);
  if (!proporciones.length) return 0.82;
  const medio = Math.floor(proporciones.length / 2);
  return proporciones.length % 2 ? proporciones[medio] : (proporciones[medio - 1] + proporciones[medio]) / 2;
}
