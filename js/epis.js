// © 2026 Adrián Barroso de Cabo.
// Hoja de EPI: a veces sale del programa sin la tabla de equipos de protección. Se detecta, se hace
// hueco bajando lo que hay debajo del párrafo de la introducción y se escribe la tabla del puesto.

import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { interpretar, lineasDeGlifos, operadores, textoDeLineas } from "./lector.js";
import { anadirContenido, anadirRecurso, cambiarContenido, contenidoPagina, escaparWinAnsi, numero } from "./pdfbase.js";

const CALZADO = "0021 - Calzado de seguridad antideslizante";
const GAFAS = "03.1 - Gafas de protección ocular de montura integral (UNE-EN 166)";
const LATEX = "1.37 - Guantes de látex";
const TERMICOS = "1.52 - Guantes de protección contra riesgos térmicos (calor y/o fuego) UNE EN 407";
const QUIMICOS = "1.53 - Guantes de protección contra productos químicos UNE EN 374";

const CAMARERO = [CALZADO, GAFAS, LATEX, TERMICOS, QUIMICOS, "7.86 - Ropa de trabajo"];
const COCINERO = [
  "0017 - Ropa de trabajo",
  "0.02 - EPIS: otros utiles para protección en el puesto de trabajo",
  ["0103 - Calzado de trabajo", "con suela antideslizante y una correcta sujeción del talón (UNE_EN ISO 20347)"],
  LATEX,
];
const COLECTIVIDADES = [CALZADO, GAFAS, LATEX, TERMICOS, QUIMICOS];

// Cada categoría con las palabras que la reconocen en el puesto (sin tildes ni mayúsculas).
const CATEGORIAS = [
  { palabras: ["camarer"], epis: CAMARERO },
  { palabras: ["cocin"], epis: COCINERO },
  { palabras: ["colectividades", "limpieza", "logistic", "mozo"], epis: COLECTIVIDADES },
];

const ENTREGA = "Usuaria";
const HUECO_ABAJO = 26.5; // de la última fila al primer renglón de "El Estatuto…"
const SEPARACION = 15;
const SEPARACION_LINEA = 13.79;
const CORTE = 590; // (y de PDF) lo que está por debajo del párrafo de la introducción baja con el hueco
const ESTATUTO_VACIO = 525.62; // dónde empieza "El Estatuto…" cuando no hay tabla
const ENCABEZADO = 557.68;
const LINEA = 552.5;
const PRIMERA_FILA = 540.14;

const sinTildes = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Los EPI que corresponden a un puesto (p. ej. "CAMARERO/A"), o null si no se conocen. */
export function episDelPuesto(puesto) {
  const limpio = sinTildes(puesto);
  return CATEGORIAS.find(({ palabras }) => palabras.some((p) => limpio.includes(p)))?.epis ?? null;
}

/** ¿Es la hoja de EPI de un documento sin la tabla de equipos? */
export function faltanEpis(lineas) {
  const texto = textoDeLineas(lineas);
  return /Estatuto/i.test(texto) && !/Entrega\s*EPI/i.test(texto) && !lineas.some((l) => /^\s*[\d.]+\s+-\s+\S/.test(textoDeLineas([l])));
}

/**
 * Deja la hoja con la tabla de EPI del puesto: baja lo de debajo de la introducción y la escribe.
 * Devuelve las líneas de texto de la hoja ya modificada.
 */
export async function ponerEpis(doc, pagina, epis) {
  const filas = [];
  let y = PRIMERA_FILA;
  for (const fila of epis) {
    const renglones = Array.isArray(fila) ? fila : [fila];
    filas.push({ renglones, y });
    y -= SEPARACION + (renglones.length - 1) * 11.6;
  }
  const ultima = filas.at(-1);
  const ultimaBase = ultima.y - (ultima.renglones.length - 1) * SEPARACION_LINEA;
  const bajar = ESTATUTO_VACIO - (ultimaBase - HUECO_ABAJO);

  cambiarContenido(doc, pagina, bajarContenido(contenidoPagina(doc, pagina), bajar));

  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const nombre = anadirRecurso(doc, pagina, "Font", "FEpi", fuente.ref);
  const texto = (x, yy, tam, contenido) => `BT /${nombre} ${tam} Tf 1 0 0 1 ${numero(x)} ${numero(yy)} Tm (${escaparWinAnsi(contenido)}) Tj ET`;
  const ops = ["q 0 g 0 G 1 w 0 J [] 0 d", texto(50, ENCABEZADO, 11, "EPI"), texto(492.75, 558.04, 11, "Entrega EPI"),
    `40 ${LINEA} m 555 ${LINEA} l S`];
  for (const { renglones, y: base } of filas) {
    renglones.forEach((r, k) => ops.push(texto(40,base - k * SEPARACION_LINEA, 12, r)));
    ops.push(texto(491.83, base, 12, ENTREGA));
  }
  ops.push("Q");
  anadirContenido(doc, pagina, ops.join("\n"));
  return lineasDeGlifos(interpretar(doc, pagina).glifos);
}

/** Baja `bajar` puntos el texto y las imágenes que hay por debajo de la introducción. */
function bajarContenido(bytes, bajar) {
  const ops = operadores(bytes);
  const cambios = [];
  ops.forEach((op, i) => {
    const conY = (op.op === "Tm" && op.operandos.length === 6) || (op.op === "cm" && op.operandos.length === 6 && ops[i + 1]?.op === "Do");
    if (!conY) return;
    const y = op.operandos[5];
    const base = op.op === "cm" ? y.valor + op.operandos[3].valor : y.valor; // la imagen se mide por su borde de arriba
    if (base < CORTE) cambios.push([y.inicio, y.fin, numero(y.valor - bajar)]);
  });
  const partes = [];
  let desde = 0;
  const codificador = new TextEncoder();
  for (const [inicio, fin, nuevo] of cambios) {
    partes.push(bytes.subarray(desde, inicio), codificador.encode(nuevo));
    desde = fin;
  }
  partes.push(bytes.subarray(desde));
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) {
    salida.set(p, i);
    i += p.length;
  }
  return salida;
}
