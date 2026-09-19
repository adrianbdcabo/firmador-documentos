// © 2026 Adrián Barroso de Cabo.
// Cambiar la fecha de "En COSLADA, a 16 de Septiembre de 2026" por otra con idéntica apariencia.
//
// La fecha se borra y se vuelve a escribir en la misma posición, tamaño y color con la MISMA
// fuente que ya trae el PDF, usando sus propios glifos: el resultado es idéntico al original.
// Los PDFs solo incluyen las letras que usan; si a la fuente le falta alguna (p. ej. el 7, la J o
// la z en la Arial Narrow de EPI), esa letra se toma de la versión normal de la fuente que también
// está en la hoja (Arial), estrechada a la anchura de la original. No hace falta ninguna fuente
// instalada en el ordenador.
//
// Para borrarla se quitan del contenido de la página justo las letras de la fecha: en su lugar se
// deja un desplazamiento del mismo ancho, así que todo lo demás queda exactamente donde estaba.

import { interpretar, lineasDeGlifos } from "./lector.js";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  aPdf,
  anadirContenido,
  anadirRecurso,
  cambiarContenido,
  comoArray,
  comoNombre,
  guardar,
  heredado,
  nombreBase,
  numero,
  obtener,
  resolver,
} from "./pdfbase.js";

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

/**
 * Una sola pasada por todo el documento que saca a la vez:
 * - `glifos`: para cada fuente, qué glifo y anchura usa para cada carácter (para escribir la fecha);
 * - `textos`: los caracteres de cada página en el orden en que se dibujan, sin espacios (para
 *   encontrar las hojas por su título).
 */
export function recorrerTexto(doc) {
  const glifos = {};
  const textos = [];
  for (const pagina of doc.getPages()) {
    const { glifos: dibujados } = interpretar(doc, pagina, { anotaciones: true });
    let texto = "";
    for (const glifo of dibujados) {
      for (const letra of glifo.c) if (letra.codePointAt(0) > 32) texto += letra;
      // Las letras solo se recogen del texto visible (relleno), con un único carácter
      if (!glifo.relleno || glifo.gid <= 0 || [...glifo.c].length !== 1 || glifo.c.codePointAt(0) < 32) continue;
      const mapa = (glifos[glifo.fuente.nombreBase] ??= {});
      if (!(glifo.c in mapa)) mapa[glifo.c] = { gid: glifo.gid, avance: glifo.avance };
    }
    textos.push(texto);
  }
  return { glifos, textos };
}

/** PDF (una hoja) con la fecha de la línea "En …" sustituida por `fecha`. */
export async function cambiarFecha(pdf, fecha, glifos) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const pagina = doc.getPage(0);
  const lectura = interpretar(doc, pagina);
  const linea = lineaConFecha(lineasDeGlifos(lectura.glifos));
  if (!linea) throw new FechaNoCambiada("no se ha encontrado la fecha en la hoja.");

  const primero = linea.chars[linea.inicio];
  const fuente = nombreBase(primero.fuente);
  // Lo que va detrás de la fecha (p. ej. el punto final) se reescribe con ella.
  const texto = fecha + linea.chars.slice(linea.fin).map((ch) => ch.c).join("").trimEnd();

  const principal = { ref: fuenteDeRecursos(doc, pagina, fuente), mapa: glifos[fuente] ?? {} };
  if (!principal.ref) throw new FechaNoCambiada(`la fuente ${fuente} de la fecha no se puede reutilizar.`);
  const nombreParecida = PARECIDAS[fuente];
  const parecida = {
    ref: nombreParecida ? fuenteDeRecursos(doc, pagina, nombreParecida) : null,
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

  // Borrar la fecha original (solo sus letras: imágenes, líneas y el resto del texto quedan intactos).
  const borrar = new Set(linea.chars.slice(linea.inicio).map((ch) => ch.glifo).filter(Boolean));
  if ([...borrar].some((glifo) => !glifo.editable)) throw new FechaNoCambiada("la fecha está dentro de un bloque que no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));

  // Escribirla de nuevo con los glifos del propio documento.
  const nombres = new Map();
  for (const tramo of tramos) {
    if (!nombres.has(tramo.origen)) nombres.set(tramo.origen, anadirRecurso(doc, pagina, "Font", "FFecha", tramo.origen.ref));
  }
  const [x, y] = aPdf(doc, pagina, primero.origen);
  const [r, g, b] = (primero.color?.length === 3 ? primero.color : [0, 0, 0]).map(numero);
  const operadores = [`q BT 0 Tc 0 Tw 0 Ts 0 Tr ${r} ${g} ${b} rg 1 0 0 1 ${numero(x)} ${numero(y)} Tm`];
  for (const tramo of tramos) {
    const escala = tramo.origen === principal ? 100 : estrechar * 100;
    operadores.push(`/${nombres.get(tramo.origen)} ${numero(primero.tamano)} Tf ${numero(escala)} Tz <${tramo.hex}> Tj`);
  }
  operadores.push("ET Q");
  anadirContenido(doc, pagina, operadores.join(" "));
  return guardar(doc);
}

function lineaConFecha(lineas) {
  for (const linea of lineas) {
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

const hex = (bytes) => `<${Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("")}>`;

/**
 * Contenido de la página sin los glifos de `borrar`. Cada operador de texto afectado se reescribe
 * como un TJ en el que las letras quitadas se cambian por un desplazamiento de su mismo ancho.
 */
function quitarGlifos(lectura, borrar) {
  const porOperador = new Map();
  for (const glifo of lectura.glifos) {
    if (!glifo.editable) continue;
    if (!porOperador.has(glifo.op)) porOperador.set(glifo.op, []);
    porOperador.get(glifo.op).push(glifo);
  }
  const cambios = [];
  for (const indice of new Set([...borrar].map((glifo) => glifo.op))) {
    const operacion = lectura.ops[indice];
    const glifos = porOperador.get(indice) ?? [];
    const piezas = operacion.op === "TJ" ? operacion.operandos[0].valor : [operacion.operandos[operacion.op === '"' ? 2 : 0]];
    const elementos = [];
    piezas.forEach((pieza, k) => {
      const numeroPieza = operacion.op === "TJ" ? k : operacion.op === '"' ? 2 : 0;
      if (pieza.tipo !== "texto") {
        elementos.push(numero(pieza.valor));
        return;
      }
      let conservados = [];
      const cerrar = () => {
        if (conservados.length) elementos.push(hex(conservados));
        conservados = [];
      };
      for (const glifo of glifos.filter((g) => g.pieza === numeroPieza)) {
        const bytes = pieza.valor.subarray(glifo.bytesInicio, glifo.bytesFin);
        if (!borrar.has(glifo)) {
          conservados.push(...bytes);
          continue;
        }
        cerrar();
        // En un TJ, un número n avanza -n/1000 del tamaño de letra: el mismo hueco que dejaba la letra
        if (glifo.tamanoFuente) elementos.push(numero((-glifo.espaciado / glifo.tamanoFuente) * 1000));
      }
      cerrar();
    });
    const tj = `[${elementos.join(" ")}] TJ`;
    let reemplazo = tj;
    if (operacion.op === "'") reemplazo = `T* ${tj}`;
    else if (operacion.op === '"') {
      const [aw, ac] = operacion.operandos;
      reemplazo = `${numero(aw.valor)} Tw ${numero(ac.valor)} Tc T* ${tj}`;
    }
    cambios.push({ inicio: operacion.inicio, fin: operacion.fin, texto: reemplazo });
  }
  cambios.sort((a, b) => a.inicio - b.inicio);
  const partes = [];
  let posicion = 0;
  const codificador = new TextEncoder();
  for (const cambio of cambios) {
    partes.push(lectura.bytes.subarray(posicion, cambio.inicio), codificador.encode(cambio.texto));
    posicion = cambio.fin;
  }
  partes.push(lectura.bytes.subarray(posicion));
  const total = partes.reduce((n, p) => n + p.length, 0);
  const salida = new Uint8Array(total);
  let i = 0;
  for (const parte of partes) {
    salida.set(parte, i);
    i += parte.length;
  }
  return salida;
}

/** Referencia a la fuente `nombre` de la página si se puede escribir con ella por número de glifo. */
function fuenteDeRecursos(doc, pagina, nombre) {
  const fuentes = obtener(doc, heredado(doc, pagina.node, "Resources"), "Font");
  if (!(fuentes instanceof PDFDict)) return null;
  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    const base = comoNombre(obtener(doc, fuente, "BaseFont"));
    if (!base || nombreBase(base) !== nombre) continue;
    if (comoNombre(obtener(doc, fuente, "Subtype")) !== "Type0" || comoNombre(obtener(doc, fuente, "Encoding")) !== "Identity-H") continue;
    const descendiente = resolver(doc, comoArray(doc, obtener(doc, fuente, "DescendantFonts"))?.[0]);
    const mapa = obtener(doc, descendiente, "CIDToGIDMap");
    if (mapa !== undefined && !(mapa instanceof PDFName && mapa.decodeText() === "Identity")) continue;
    if (mapa instanceof PDFStream) continue;
    return valor instanceof PDFRef ? valor : doc.context.register(fuente);
  }
  return null;
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
