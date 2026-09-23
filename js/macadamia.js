// © 2026 Adrián Barroso de Cabo.
// Documento especial de MACADAMIA: el recibí de la evaluación de riesgos y el plan de emergencias
// del centro de trabajo de GMV.
//
// POR QUÉ ESTE NO SE RELLENA COMO LOS DEMÁS
// Los otros documentos especiales son impresos con huecos de puntitos: basta con escribir cada
// dato en su sitio (eso es lo que hace js/especiales.js). Aquí no hay huecos: el nombre y el DNI
// van metidos en medio de una frase escrita en Word, justificada de margen a margen. Si se
// escribiera el nombre encima y ya está, al ser más largo o más corto que el del ejemplo se
// montaría sobre la palabra siguiente o dejaría un boquete.
//
// Por eso se hace igual que en el TA2 de la Seguridad Social: se lee el párrafo letra a letra, se
// cambian el nombre y el DNI, se vuelven a repartir las palabras en líneas justificadas y se
// dibujan con la misma Calibri que trae el documento. El resultado no se distingue de un
// documento escrito en Word: mismos márgenes, mismo interlineado, mismo espaciado entre palabras.
//
// LO QUE SE CAMBIA Y LO QUE NO
// Solo el nombre, el DNI y la fecha del "Fecha y firma". El logotipo de GMV, el sello de TEMPS con
// la firma y el resto del texto se quedan exactamente como están en la plantilla.

import { quitarGlifos } from "./fecha.js";
import { interpretar, lineasDeGlifos } from "./lector.js";
import { enPalabras, escribir, mapasWinAnsi, repartirEnLineas } from "./parrafo.js";
import { abrirPdf, cambiarContenido, guardar, nombreBase } from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

// El párrafo del documento, con el nombre y el DNI marcados para poder cambiarlos:
// "Por la presente, la empresa TEMPS MULTIWORK ETT hace entrega al trabajador NOMBRE APELLIDOS
//  con DNI 00000000A la evaluación de riesgos y el plan de emergencias del Centro de Trabajo de GMV."
const PATRON = /al trabajador\s+(?<nombre>.+?)\s+con DNI\s+(?<documento>[0-9A-Za-z]{5,14})\s+la evaluaci/u;
// Los dos datos, en el orden en que salen en la frase (importa al sustituirlos).
const CLAVES = ["nombre", "documento"];
// La fecha del renglón de abajo, "Fecha y firma 22.09.2026".
const FECHA = /\d{1,2}\.\d{1,2}\.\d{4}/;

/** Error con mensaje en español, igual que en el TA2: lo recoge app.js y lo enseña en un aviso. */
export class MacadamiaNoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "MacadamiaNoRellenado";
  }
}

/** La fecha como la escribe el documento: "23.09.2026". */
export function fechaConPuntos(fecha) {
  const dos = (n) => String(n).padStart(2, "0");
  return `${dos(fecha.getDate())}.${dos(fecha.getMonth() + 1)}.${fecha.getFullYear()}`;
}

/** Los bytes del documento de MACADAMIA relleno, listos para descargar. */
export async function generarMacadamia(plantilla, datos) {
  const doc = await abrirPdf(plantilla);
  await rellenarMacadamia(doc, datos);
  return guardar(doc);
}

/**
 * Cambia en el documento ya abierto el nombre, el DNI y la fecha. `datos` es el mismo objeto que
 * reciben los demás documentos especiales: trabajador, dni y fecha.
 */
export async function rellenarMacadamia(doc, datos) {
  const pagina = doc.getPage(0); // es de una sola hoja
  const fecha = datos.fecha ?? new Date();

  // (1) Cuánto mide cada letra en las fuentes del documento. Se saca de la tabla de anchuras del
  //     propio PDF, que las trae todas, y no de las letras ya escritas: el nombre va en negrita y
  //     de la negrita el documento solo tiene escritas las letras del ejemplo.
  const mapas = mapasWinAnsi(doc, pagina);
  const respaldo = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const medida = { mapas, respaldo };

  // (2) Leer la página entera y quedarse con las líneas del párrafo.
  const lectura = interpretar(doc, pagina);
  const lineas = lineasDeGlifos(lectura.glifos);
  const parrafo = localizarParrafo(lineas);
  const chars = charsDelParrafo(parrafo.lineas);
  const encontrado = PATRON.exec(chars.map((ch) => ch.c).join(""));
  if (!encontrado) throw new MacadamiaNoRellenado("no se reconoce la frase del recibí.");

  // (3) Cambiar el nombre y el DNI. Cada letra nueva copia la fuente, el tamaño y el color de la
  //     primera letra del dato viejo, que es lo que hace que sigan saliendo en negrita. Se
  //     sustituye de atrás hacia delante para que no se muevan las posiciones de los anteriores.
  const valores = {
    nombre: (datos.trabajador ?? "").replace(/\s+/g, " ").trim(),
    documento: (datos.dni ?? "").replace(/\s+/g, "").toUpperCase(),
  };
  if (!valores.nombre) throw new MacadamiaNoRellenado("no se sabe el nombre del trabajador.");
  let nuevos = chars;
  for (const grupo of posicionesDeGrupos(encontrado).reverse()) {
    const modelo = nuevos[grupo.inicio];
    const reemplazo = [...valores[grupo.clave]].map((c) => ({ ...modelo, c, glifo: null }));
    nuevos = [...nuevos.slice(0, grupo.inicio), ...reemplazo, ...nuevos.slice(grupo.inicio + grupo.largo)];
  }

  // (4) Repartir otra vez las palabras en líneas justificadas, dentro de los mismos márgenes.
  const colocadas = repartirEnLineas(enPalabras(nuevos, medida), parrafo, medida);

  // (5) Apuntar para borrar las letras viejas del párrafo y las de la fecha de abajo.
  const borrar = new Set(chars.map((ch) => ch.glifo).filter(Boolean));
  colocadas.push(fechaColocada(lineas, fechaConPuntos(fecha), borrar));

  // (6) Borrar de verdad y dibujar lo nuevo encima. Todo lo demás (el logotipo de GMV, el sello y
  //     la firma) no se toca: `quitarGlifos` solo quita las letras que se le dicen.
  if ([...borrar].some((glifo) => !glifo.editable)) throw new MacadamiaNoRellenado("el párrafo no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));
  escribir(doc, pagina, colocadas, medida);

  return { lineas: colocadas.length - 1, valores };
}

/** El texto de una línea, juntando sus letras. */
const textoDe = (linea) => linea.chars.map((ch) => ch.c).join("");

/**
 * Encuentra el párrafo del recibí y mide su caja: dónde empieza, hasta dónde llega, a qué altura
 * va cada línea y cuánto baja de una a la siguiente. Con eso se vuelve a componer en el mismo sitio.
 */
function localizarParrafo(lineas) {
  const inicio = lineas.findIndex((l) => textoDe(l).includes("Por la presente"));
  if (inicio < 0) throw new MacadamiaNoRellenado("no se encuentra el párrafo del recibí.");

  // El párrafo llega hasta la línea que cierra con el punto final (son 2 o 3 según el nombre).
  const usadas = [];
  for (let i = inicio; i < Math.min(inicio + 5, lineas.length); i++) {
    usadas.push(lineas[i]);
    if (/\.\s*$/.test(textoDe(lineas[i]))) break;
  }

  const origenes = usadas.map((l) => l.chars.find((ch) => ch.glifo).glifo.origen);
  const izquierda = Math.min(...origenes.map((o) => o[0]));
  // El margen derecho es donde acaban las líneas justificadas, sin contar el espacio final: el
  // documento lo estira más allá del margen y daría una columna más ancha de la cuenta.
  const derechas = usadas.slice(0, -1).map((l) => {
    const ultimo = l.chars.filter((ch) => ch.glifo && ch.c.trim() !== "").at(-1).glifo;
    return ultimo.origen[0] + ultimo.espaciado;
  });

  return {
    lineas: usadas,
    izquierda,
    ancho: Math.max(...derechas) - izquierda,
    yes: origenes.map((o) => o[1]),
    interlineado: origenes.length > 1 ? origenes[1][1] - origenes[0][1] : 29.35,
  };
}

/**
 * Las letras del párrafo seguidas, como si fuera un solo renglón, con un espacio en cada salto de
 * línea. De cada letra se apunta si va en negrita, que es lo que distingue el nombre y el DNI del
 * texto corrido.
 */
function charsDelParrafo(lineas) {
  const chars = [];
  lineas.forEach((linea, i) => {
    if (i > 0 && chars.at(-1)?.c !== " ") chars.push({ ...linea.chars[0], c: " ", glifo: null });
    for (const ch of linea.chars) chars.push({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") });
  });
  return chars;
}

/** En qué posición del párrafo empieza cada dato y cuántas letras ocupa. */
function posicionesDeGrupos(encontrado) {
  const posiciones = [];
  let desde = 0;
  for (const clave of CLAVES) {
    const valor = encontrado.groups[clave];
    const pos = encontrado[0].indexOf(valor, desde);
    if (pos < 0) throw new MacadamiaNoRellenado(`no se localiza ${clave} en la frase.`);
    posiciones.push({ clave, inicio: encontrado.index + pos, largo: valor.length });
    desde = pos + valor.length;
  }
  return posiciones;
}

/**
 * La fecha nueva del renglón "Fecha y firma", puesta donde empezaba la vieja y con su misma letra.
 * Ese renglón no está justificado y la fecha va al final, así que no hay que recomponer nada: se
 * borran las letras de la fecha vieja (se añaden a `borrar`) y se escribe la nueva en su sitio.
 */
function fechaColocada(lineas, texto, borrar) {
  const linea = lineas.find((l) => FECHA.test(textoDe(l)));
  if (!linea) throw new MacadamiaNoRellenado("no se encuentra la fecha del documento.");
  const encontrado = FECHA.exec(textoDe(linea));
  const viejas = linea.chars.slice(encontrado.index, encontrado.index + encontrado[0].length);
  for (const ch of viejas) if (ch.glifo) borrar.add(ch.glifo);

  const modelo = viejas.find((ch) => ch.glifo);
  const [x, y] = modelo.glifo.origen;
  const chars = [...texto].map((c) => ({ ...modelo, c, glifo: null, negrita: false }));
  return [{ chars, texto, x, y }];
}
