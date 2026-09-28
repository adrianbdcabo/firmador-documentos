// © 2026 Adrián Barroso de Cabo.
// Documento especial de CALIER: el acuse de recibo de la normativa de salud, prevención, medio
// ambiente e higiene del Grupo Indukern (al que pertenecen los Laboratorios Calier).
//
// POR QUÉ ESTE NO SE RELLENA COMO LOS DEMÁS
// Es una carta escrita en Word, como la de MACADAMIA. Los huecos del nombre y de la empresa no son
// sitios libres de la página sino puntos suspensivos metidos en medio de la frase:
//   "El trabajador ………………… de la empresa ………………… "
// Si se escribiera el nombre encima de los puntos, estos seguirían viéndose alrededor; y si se
// taparan, quedaría un boquete o el nombre se montaría sobre "de la empresa". Así que se hace igual
// que en MACADAMIA y en el TA2: se lee la frase letra a letra, se cambian los puntos por el nombre y
// por la empresa, se vuelven a repartir las palabras entre los mismos márgenes (con un nombre muy
// largo la frase pasa a dos renglones) y se dibujan con la misma Calibri que trae el documento.
//
// LO QUE SE CAMBIA Y LO QUE NO
// La frase de arriba y la fecha, que se escribe detrás de "Firma y fecha:" con la misma letra. La
// X de la casilla de LES FRANQUESES y la firma del trabajador no se tocan aquí: van en los `campos`
// de su ficha (js/especiales.js), como en cualquier otro impreso. El logotipo y el resto del
// texto se quedan exactamente como están en la plantilla.

import { quitarGlifos } from "./fecha.js";
import { interpretar, lineasDeGlifos } from "./lector.js";
import { anchoChar, enPalabras, escribir, mapasWinAnsi, repartirEnLineas } from "./parrafo.js";
import { abrirPdf, cambiarContenido, guardar, nombreBase } from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

// La frase con sus dos huecos de puntos (Word los mezcla: "………………..……………………..………….."),
// marcados para poder cambiarlos.
const PATRON = /El trabajador\s*(?<nombre>[….]{3,})\s*de la empresa\s*(?<empresa>[….]{3,})/u;
// Los dos datos, en el orden en que salen en la frase (importa al sustituirlos).
const CLAVES = ["nombre", "empresa"];
// La empresa que va en el hueco, escrita como en el documento de ejemplo.
const EMPRESA = "TEMPS MULTIWORK ETT S.L.";

/** Error con mensaje en español, igual que en el TA2: lo recoge app.js y lo enseña en un aviso. */
export class CalierNoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "CalierNoRellenado";
  }
}

/** La fecha como se escribe en el documento: "28/09/2026". */
export function fechaConBarras(fecha) {
  const dos = (n) => String(n).padStart(2, "0");
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/** Los bytes del documento de CALIER con la frase y la fecha rellenas. */
export async function generarCalier(plantilla, datos) {
  const doc = await abrirPdf(plantilla);
  await rellenarCalier(doc, datos);
  return guardar(doc);
}

/**
 * Cambia en el documento ya abierto el nombre, la empresa y la fecha. `datos` es el mismo objeto que
 * reciben los demás documentos especiales: trabajador y fecha.
 */
export async function rellenarCalier(doc, datos) {
  const pagina = doc.getPage(0); // es de una sola hoja
  const fecha = datos.fecha ?? new Date();

  // (1) Cuánto mide cada letra en las fuentes del documento, sacado de la tabla de anchuras del
  //     propio PDF. La plantilla trae la Calibri completa (scripts/plantilla-calier.mjs), así que
  //     están todas las letras y no solo las que salían en el impreso en blanco.
  const mapas = mapasWinAnsi(doc, pagina);
  const respaldo = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const medida = { mapas, respaldo };

  // (2) Leer la página entera y quedarse con la línea de la frase.
  const lectura = interpretar(doc, pagina);
  const lineas = lineasDeGlifos(lectura.glifos);
  const linea = lineas.find((l) => PATRON.test(textoDe(l)));
  if (!linea) throw new CalierNoRellenado("no se reconoce la frase del acuse de recibo.");
  const chars = linea.chars.map((ch) => ({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") }));
  const encontrado = PATRON.exec(textoDe(linea));

  // (3) Cambiar los puntos por el nombre y por la empresa. Cada letra nueva copia la fuente, el
  //     tamaño y el color del primer punto del hueco. Se sustituye de atrás hacia delante para que
  //     no se muevan las posiciones de los anteriores.
  const valores = { nombre: (datos.trabajador ?? "").replace(/\s+/g, " ").trim(), empresa: EMPRESA };
  if (!valores.nombre) throw new CalierNoRellenado("no se sabe el nombre del trabajador.");
  let nuevos = chars;
  for (const grupo of posicionesDeGrupos(encontrado).reverse()) {
    const modelo = nuevos[grupo.inicio];
    const reemplazo = [...valores[grupo.clave]].map((c) => ({ ...modelo, c, glifo: null }));
    nuevos = [...nuevos.slice(0, grupo.inicio), ...reemplazo, ...nuevos.slice(grupo.inicio + grupo.largo)];
  }

  // (4) Repartir las palabras entre los mismos márgenes. Casi siempre cabe en un renglón, que no se
  //     estira; con un nombre muy largo pasa al siguiente, que en la plantilla está en blanco.
  const parrafo = cajaDeLaFrase(lineas, linea);
  const colocadas = repartirEnLineas(enPalabras(nuevos, medida), parrafo, medida);

  // (5) Apuntar para borrar las letras viejas de la frase y añadir la fecha detrás de "Firma y fecha:".
  const borrar = new Set(chars.map((ch) => ch.glifo).filter(Boolean));
  colocadas.push(fechaColocada(lineas, fechaConBarras(fecha), medida));

  // (6) Borrar de verdad y dibujar lo nuevo encima. `quitarGlifos` solo quita las letras que se le
  //     dicen: el logotipo, la tabla de centros y el resto del texto se quedan como estaban.
  if ([...borrar].some((glifo) => !glifo.editable)) throw new CalierNoRellenado("la frase no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));
  escribir(doc, pagina, colocadas, medida);

  return { lineas: colocadas.length - 1, valores };
}

/** El texto de una línea, juntando sus letras. */
const textoDe = (linea) => linea.chars.map((ch) => ch.c).join("");

/** Dónde empieza una línea y dónde acaba su última letra (sin contar los espacios del final). */
function bordesDe(linea) {
  const letras = linea.chars.filter((ch) => ch.glifo && ch.c.trim() !== "");
  const ultimo = letras.at(-1).glifo;
  return { izquierda: letras[0].glifo.origen[0], derecha: ultimo.origen[0] + ultimo.espaciado, y: letras[0].glifo.origen[1] };
}

/**
 * La caja en la que se vuelve a componer la frase: empieza donde empezaba ella y llega hasta el
 * margen derecho del documento, que se mide en el párrafo justificado de más abajo
 * ("Comprometiéndose a desarrollar…"), cuyas líneas acaban todas justo en ese margen. El
 * interlineado también se saca de ese párrafo, que está escrito con la misma letra.
 */
function cajaDeLaFrase(lineas, linea) {
  const propia = bordesDe(linea);
  const inicio = lineas.findIndex((l) => textoDe(l).includes("Comprometiéndose"));
  const justificadas = inicio < 0 ? [] : lineas.slice(inicio, inicio + 2).map(bordesDe);
  const derecha = justificadas.length ? Math.max(...justificadas.map((b) => b.derecha)) : propia.derecha;
  return {
    izquierda: propia.izquierda,
    ancho: derecha - propia.izquierda,
    yes: [propia.y],
    interlineado: justificadas.length > 1 ? justificadas[1].y - justificadas[0].y : 13.45,
  };
}

/** En qué posición de la frase empieza cada hueco y cuántas letras ocupa. */
function posicionesDeGrupos(encontrado) {
  const posiciones = [];
  let desde = 0;
  for (const clave of CLAVES) {
    const valor = encontrado.groups[clave];
    const pos = encontrado[0].indexOf(valor, desde);
    if (pos < 0) throw new CalierNoRellenado(`no se localiza el hueco de ${clave} en la frase.`);
    posiciones.push({ clave, inicio: encontrado.index + pos, largo: valor.length });
    desde = pos + valor.length;
  }
  return posiciones;
}

/**
 * La fecha del día, detrás de "Firma y fecha:" y con su misma letra, separada por un espacio. En la
 * plantilla ese renglón acaba en los dos puntos, así que no hay nada que borrar.
 */
function fechaColocada(lineas, texto, medida) {
  const linea = lineas.find((l) => textoDe(l).includes("Firma y fecha:"));
  if (!linea) throw new CalierNoRellenado("no se encuentra el renglón de «Firma y fecha».");
  const dosPuntos = linea.chars.findLastIndex((ch) => ch.c === ":");
  const modelo = { ...linea.chars[dosPuntos], negrita: nombreBase(linea.chars[dosPuntos].fuente).includes("Bold") };
  const [x0, y] = modelo.glifo.origen;
  const x = x0 + modelo.glifo.espaciado + anchoChar({ ...modelo, c: " " }, medida);
  const chars = [...texto].map((c) => ({ ...modelo, c, glifo: null }));
  return [{ chars, texto, x, y }];
}
