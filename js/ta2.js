// © 2026 Adrián Barroso de Cabo.
// Rellenar un TA2 (informe de situación de alta de la Seguridad Social) con los datos del
// trabajador del documento laboral cargado: nombre, fecha de nacimiento, NAF y DNI/NIE. La fecha
// de efectos del alta se pone la del día en que se genera, en los dos sitios donde sale: en el
// párrafo del alta ("con fecha 21/09/2026") y en el renglón de arriba ("21 de septiembre de 2026").
//
// CÓMO FUNCIONA, DE PRINCIPIO A FIN
//  1. `datosDelLaboral` lee el documento laboral y saca de la hoja INFO los cuatro datos.
//  2. `rellenarTA2` abre la plantilla (plantillas/ta2.pdf) y lee el párrafo del alta letra a letra,
//     apuntando de cada letra su fuente, su tamaño y en qué punto de la página está dibujada.
//  3. Dentro de ese texto localiza los cuatro datos con una expresión regular y los cambia por los
//     del trabajador; el resto del párrafo se queda igual.
//  4. Con el texto ya cambiado, `repartirEnLineas` vuelve a repartir las palabras en líneas
//     justificadas: mismo margen izquierdo y derecho, mismo interlineado y espacios estirados por
//     igual hasta el margen, que es exactamente como compone el documento original.
//  5. `quitarGlifos` (de fecha.js) borra del PDF las letras viejas y `escribir` dibuja las nuevas.
//
// POR QUÉ NO SE "PARCHEA" SOLO EL DATO
// El párrafo está justificado: si el nombre nuevo es más largo o más corto, cambian los saltos de
// línea y la separación entre TODAS las palabras. Por eso se borra el párrafo entero y se vuelve a
// componer. Y si acaba ocupando una línea más (o menos), el párrafo siguiente baja o sube, igual
// que en los informes reales.
//
// LAS LETRAS SE ESCRIBEN CON LAS FUENTES DEL PROPIO PDF
// El TA2 lleva dentro su Arial y su Arial Bold, pero solo con las letras que usa. Cada letra se
// dibuja pidiéndole a esa fuente su número de glifo, así que sale idéntica a las de al lado. Si al
// PDF le falta alguna letra (la Ñ de "VIÑA", por ejemplo, que no aparece en el original), esa se
// escribe con una Helvetica normal, que tiene exactamente las mismas anchuras que Arial.
//
// LA CODIFICACIÓN INFORMÁTICA SE DEJA EN BLANCO
// El recuadro del pie (referencia, fecha, hora y huella) es lo que certifica que la Tesorería
// validó ESOS datos, los de la persona del documento original. Dejarlo con los datos de otro sería
// un certificado falso, así que esas cuatro casillas se vacían; el propio impreso ya avisa debajo
// de que sin la codificación el documento no es válido.

import { MESES, quitarGlifos, recorrerTexto } from "./fecha.js";
import { interpretar, lineasDeGlifos } from "./lector.js";
// El reparto en líneas justificadas y el dibujo con las letras del propio PDF son comunes a este
// documento y al de MACADAMIA, así que viven aparte, en parrafo.js.
import { anchoChar, enPalabras, escribir, repartirEnLineas } from "./parrafo.js";
import { abrirPdf, cambiarContenido, guardar, nombreBase } from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

// El párrafo del TA2, con los datos entre paréntesis para poder sustituirlos por separado:
// "… de D./Dña. NOMBRE, con fecha de nacimiento 07/02/2006, con número de afiliación 28 1501917624
//  y DNI 072008038Y, con fecha 19/09/2026, como trabajador de …"
const PATRON = /D\.\/Dña\.\s+(?<nombre>[^,]+?)\s*,\s*con fecha de nacimiento\s+(?<nacimiento>\d{1,2}\/\d{1,2}\/\d{4})\s*,\s*con número de afiliación\s+(?<naf>\d{2}\s?\d{10})\s*y\s*(?<tipo>DNI|NIE)\s+(?<documento>[0-9A-Za-z]{8,12})\s*,\s*con fecha\s+(?<alta>\d{1,2}\/\d{1,2}\/\d{4})\s*,/u;
// La frase de la hoja INFO del documento laboral, que es la única que trae el NAF y el nacimiento:
// "El/La trabajador/a OSAFAMEN, CINTHIA con N.I.F./N.I.E./Pasaporte: Y6912244E, Nº Afilición a la
//  Seg. Soc.:281548815306 y fecha de nacimiento:16-02-1994"  ("Afilición" está así en el original).
const PATRON_LABORAL = /trabajador\/a\s+(?<nombre>.+?)\s+con\s+N\.I\.F\.\/N\.I\.E\.\/Pasaporte:\s*(?<documento>[0-9A-Za-z]+)\s*,.{0,40}?Afilici[oó]n a la Seg\. Soc\.:\s*(?<naf>\d+)\s*y fecha de nacimiento:\s*(?<nacimiento>\d{1,2}[-/]\d{1,2}[-/]\d{4})/su;
// Los datos, en el mismo orden en que aparecen en el párrafo (importa para sustituirlos).
const CLAVES = ["nombre", "nacimiento", "naf", "tipo", "documento", "alta"];
// La fecha escrita con letra del renglón "…es la que se indica a continuación: 19 de septiembre de 2026".
const FECHA_EFECTOS = /\d{1,2} de \p{L}+ de \d{4}/u;

/** Error con mensaje en español: lo recoge app.js y lo enseña en un aviso. */
export class TA2NoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "TA2NoRellenado";
  }
}

/**
 * Lo que llama el botón "TA2 del trabajador": coge la plantilla y el documento laboral ya abierto,
 * y devuelve los bytes del PDF listo para descargar. `fecha` es la fecha de efectos del alta que
 * se escribe en el informe; si no se dice otra cosa, la de hoy.
 */
export async function generarTA2(plantilla, docLaboral, fecha = new Date()) {
  const doc = await abrirPdf(plantilla);
  const resultado = await rellenarTA2(doc, datosDelLaboral(docLaboral), fecha);
  return { pdf: await guardar(doc), ...resultado };
}

/**
 * Nombre, documento, NAF y fecha de nacimiento del trabajador, buscando la frase de la hoja INFO
 * página a página (la hoja no siempre está en el mismo sitio del documento laboral).
 */
export function datosDelLaboral(doc) {
  for (const pagina of doc.getPages()) {
    // `interpretar` devuelve las letras dibujadas y `lineasDeGlifos` las agrupa en líneas; se juntan
    // todas en un solo texto para poder buscar la frase aunque esté partida en varias líneas.
    const lineas = lineasDeGlifos(interpretar(doc, pagina).glifos);
    const texto = lineas.map((l) => l.chars.map((ch) => ch.c).join("")).join(" ").replace(/\s+/g, " ");
    const encontrado = PATRON_LABORAL.exec(texto);
    // `nombre` sale ya en orden normal ("CINTHIA OSAFAMEN") y `nombreCrudo` tal cual lo escribe el
    // documento laboral ("OSAFAMEN, CINTHIA"), que es de donde se sacan los apellidos por separado.
    if (encontrado) return { ...encontrado.groups, nombreCrudo: encontrado.groups.nombre, nombre: nombreDirecto(encontrado.groups.nombre) };
  }
  throw new TA2NoRellenado("el documento laboral no trae el NAF y la fecha de nacimiento del trabajador.");
}

/** "OSAFAMEN, CINTHIA" -> "CINTHIA OSAFAMEN": la Seguridad Social pone antes el nombre. */
export function nombreDirecto(nombre) {
  const partes = nombre.split(",");
  const texto = partes.length < 2 ? nombre : `${partes[1]} ${partes[0]}`;
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * El número de documento como lo escribe la Seguridad Social: siempre 10 caracteres, rellenando
 * con ceros por delante ("Y6912244E" -> "0Y6912244E", "53850518C" -> "053850518C"). Si empieza por
 * X, Y o Z es un NIE y el rótulo cambia de "DNI" a "NIE".
 */
export function documentoFormateado(documento) {
  const limpio = documento.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return { tipo: /^[XYZ]/.test(limpio) ? "NIE" : "DNI", valor: limpio.padStart(10, "0") };
}

/** El NAF con el hueco que lleva en el informe: "281548815306" -> "28 1548815306". */
export function nafFormateado(naf) {
  const limpio = naf.replace(/\D/g, "").padStart(12, "0");
  return `${limpio.slice(0, 2)} ${limpio.slice(2)}`;
}

/** La fecha del alta con barras, como la escribe el TA2 en el párrafo: "21/09/2026". */
export function fechaConBarras(fecha) {
  const dos = (n) => String(n).padStart(2, "0");
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/**
 * La misma fecha escrita con letra, como sale en el renglón de arriba: "21 de septiembre de 2026".
 * El mes va en minúscula y el día sin cero delante, que es como lo pone el informe original.
 */
export function fechaConLetra(fecha) {
  return `${fecha.getDate()} de ${MESES[fecha.getMonth()].toLowerCase()} de ${fecha.getFullYear()}`;
}

/** La fecha con barras y dos cifras, como en el TA2: "16-02-1994" -> "16/02/1994". */
export function fechaBarras(texto) {
  const partes = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(texto);
  if (!partes) throw new TA2NoRellenado(`fecha de nacimiento no reconocida: ${texto}`);
  return `${partes[1].padStart(2, "0")}/${partes[2].padStart(2, "0")}/${partes[3]}`;
}

/**
 * El trabajo de verdad: cambia en el TA2 ya abierto los datos del trabajador por los de `datos`.
 * Los pasos van numerados para poder seguirlos.
 */
export async function rellenarTA2(doc, datos, fecha = new Date()) {
  const pagina = doc.getPage(0); // el informe es siempre de una sola página

  // (1) Qué letras trae cada fuente del PDF: para cada una, su número de glifo y su anchura.
  //     Es lo que permite escribir después con las mismas letras que ya usa el documento.
  const { glifos: mapas } = recorrerTexto(doc);
  // Fuentes de repuesto para las letras que el PDF no traiga (Arial y Helvetica miden igual).
  const respaldo = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  // (2) Leer la página: `lectura` trae todas las letras dibujadas con su posición, y además los
  //     operadores y los bytes del contenido, que es lo que luego hay que reescribir.
  const lectura = interpretar(doc, pagina);
  const lineas = lineasDeGlifos(lectura.glifos);

  // (3) Quedarse con el párrafo del alta y con su texto seguido, para buscar en él los datos.
  const parrafo = localizarParrafo(lineas);
  const chars = charsDelParrafo(parrafo.lineas);
  const texto = chars.map((ch) => ch.c).join("");
  const encontrado = PATRON.exec(texto);
  if (!encontrado) throw new TA2NoRellenado("no se reconoce el párrafo de datos del trabajador.");

  // (4) Los valores nuevos, ya con el formato del informe.
  const documento = documentoFormateado(datos.documento);
  const valores = {
    nombre: datos.nombre.replace(/\s+/g, " ").trim(),
    nacimiento: fechaBarras(datos.nacimiento),
    naf: nafFormateado(datos.naf),
    tipo: documento.tipo,
    documento: documento.valor,
    alta: fechaConBarras(fecha), // la fecha de efectos del alta: la de hoy
  };

  // (5) Cambiar cada dato en la lista de letras. Cada letra nueva copia la fuente, el tamaño y el
  //     color de la primera letra del dato viejo (así el dato sigue saliendo en negrita), y se
  //     sustituye de atrás hacia delante para que las posiciones de los datos anteriores no bailen.
  let nuevos = chars;
  for (const grupo of posicionesDeGrupos(encontrado).reverse()) {
    const modelo = nuevos[grupo.inicio];
    const reemplazo = [...valores[grupo.clave]].map((c) => ({ ...modelo, c, glifo: null }));
    nuevos = [...nuevos.slice(0, grupo.inicio), ...reemplazo, ...nuevos.slice(grupo.inicio + grupo.largo)];
  }

  // (6) Volver a repartir las palabras en líneas justificadas y calcular dónde va cada una.
  const medida = { mapas, respaldo }; // lo que hace falta para medir letras: fuentes del PDF + repuesto
  const colocadas = repartirEnLineas(enPalabras(nuevos, medida), parrafo, medida);
  const lineasNuevas = colocadas.length;

  // (7) Apuntar las letras viejas que hay que borrar: primero las del párrafo.
  const borrar = new Set(chars.map((ch) => ch.glifo).filter(Boolean));

  // (8) El renglón de debajo ("La fecha de efectos… 19 de septiembre de 2026") repite la misma
  //     fecha del alta con letra, así que también hay que ponerlo al día. Y, de paso, si el
  //     párrafo ha pasado a ocupar más (o menos) líneas, este renglón baja o sube lo mismo para
  //     que siga quedando la línea en blanco de siempre entre los dos.
  const desplazamiento = (lineasNuevas - parrafo.lineas.length) * parrafo.interlineado;
  const siguiente = lineas.find((l) => textoDe(l).trimStart().startsWith("La fecha de efectos"));
  if (!siguiente) throw new TA2NoRellenado("no se encuentra el párrafo de la fecha de efectos.");
  for (const ch of siguiente.chars) if (ch.glifo) borrar.add(ch.glifo);
  colocadas.push(palabrasColocadas(siguiente, desplazamiento, medida, fechaConLetra(fecha)));

  // (9) Y también las cuatro casillas de la codificación informática del pie.
  for (const glifo of glifosDeCodificacion(lineas)) borrar.add(glifo);

  // (10) Borrar de verdad y escribir lo nuevo encima. `quitarGlifos` devuelve el contenido de la
  //      página sin esas letras (todo lo demás —líneas, recuadros, logos— queda intacto).
  if ([...borrar].some((glifo) => !glifo.editable)) throw new TA2NoRellenado("el párrafo no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));
  escribir(doc, pagina, colocadas, medida);

  return { lineasOriginales: parrafo.lineas.length, lineasNuevas, desplazamiento, valores };
}

/**
 * Vuelve a colocar las palabras de un renglón `desplazamiento` puntos más abajo (o más arriba, si
 * el número es negativo) y, si se le pasa `fechaNueva`, le cambia la fecha escrita con letra.
 *
 * Las palabras que van ANTES de la fecha se quedan clavadas en su sitio de siempre: se les copia
 * la posición que tenían en el original. A partir de la fecha ya no vale, porque la nueva puede
 * ocupar más o menos ("19 de septiembre" frente a "1 de mayo"), así que esas se van colocando una
 * detrás de otra midiéndolas, empezando justo donde empezaba la fecha vieja.
 */
function palabrasColocadas(linea, desplazamiento, medida, fechaNueva) {
  let chars = linea.chars.map((ch) => ({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") }));
  const y = chars.find((ch) => ch.glifo).glifo.origen[1] + desplazamiento;
  const cambio = fechaNueva ? FECHA_EFECTOS.exec(chars.map((ch) => ch.c).join("")) : null;

  // Dónde empieza la fecha vieja: ahí mismo empezará la nueva.
  let desdeX = null;
  if (cambio) {
    const modelo = chars[cambio.index]; // la fecha va en negrita: se copia su fuente y su tamaño
    desdeX = modelo.glifo.origen[0];
    chars = [
      ...chars.slice(0, cambio.index),
      ...[...fechaNueva].map((c) => ({ ...modelo, c, glifo: null })),
      ...chars.slice(cambio.index + cambio[0].length),
    // "recolocar" marca las letras de la fecha y todo lo que vaya detrás (aquí, el punto final).
    ].map((ch, i) => (i >= cambio.index ? { ...ch, recolocar: true } : ch));
  }

  const espacio = anchoChar({ ...chars[0], c: " ", negrita: false }, medida) || 0.278 * chars[0].tamano;
  let x = 0;
  let primeraMovida = true;
  return enPalabras(chars, medida).map((palabra) => {
    if (!palabra.chars.some((ch) => ch.recolocar)) x = palabra.chars.find((ch) => ch.glifo).glifo.origen[0];
    else if (primeraMovida) {
      x = desdeX;
      primeraMovida = false;
    }
    const colocada = { ...palabra, x, y };
    x += palabra.ancho + espacio; // por si la siguiente palabra hay que recolocarla
    return colocada;
  });
}

/**
 * Los valores del recuadro de codificación informática, que son los que se dejan en blanco: la
 * referencia (T4702609000001), la fecha, la hora y la huella (H6KW88G0). Se reconocen por su forma
 * y porque están en el pie de la página; los rótulos "REFERENCIA:", "FECHA:"… no se tocan.
 */
function glifosDeCodificacion(lineas) {
  const glifos = [];
  for (const linea of lineas) {
    const primero = linea.chars.find((ch) => ch.glifo);
    // La Y crece hacia abajo (origen arriba a la izquierda), así que 700 es ya la zona del pie.
    if (!primero || primero.glifo.origen[1] < 700) continue;
    if (!/^(T\d{10,14}|\d{2}[-/]\d{2}[-/]\d{4}|\d{2}:\d{2}:\d{2}|[A-Z0-9]{8})$/.test(textoDe(linea).trim())) continue;
    for (const ch of linea.chars) if (ch.glifo) glifos.push(ch.glifo);
  }
  return glifos;
}

// ------------------------------------------------------------------ lectura del párrafo

/** El texto de una línea, juntando sus letras. */
const textoDe = (linea) => linea.chars.map((ch) => ch.c).join("");

/**
 * Encuentra el párrafo del alta y mide su caja: desde dónde empieza, hasta dónde llega, a qué
 * altura va cada línea y cuánto separa una línea de la siguiente. Con eso, el párrafo nuevo se
 * puede componer exactamente en el mismo sitio.
 */
function localizarParrafo(lineas) {
  const inicio = lineas.findIndex((l) => textoDe(l).includes("ha procedido a reconocer"));
  if (inicio < 0) throw new TA2NoRellenado("no se encuentra el párrafo del alta.");

  // El párrafo son las líneas que van desde esa hasta la que cierra con el punto final después del
  // código de cuenta de cotización (son 3 o 4 según lo largo que sea el nombre).
  const usadas = [];
  let acumulado = "";
  for (let i = inicio; i < Math.min(inicio + 6, lineas.length); i++) {
    usadas.push(lineas[i]);
    acumulado += (acumulado ? " " : "") + textoDe(lineas[i]).trim();
    if (/cotización/.test(acumulado) && /\.\s*$/.test(acumulado)) break;
  }

  // Dónde empieza cada línea (x) y a qué altura va (y), tomando la primera letra de cada una.
  const origenes = usadas.map((l) => l.chars.find((ch) => ch.glifo).glifo.origen);
  const izquierda = Math.min(...origenes.map((o) => o[0]));
  // El margen derecho es donde terminan las líneas justificadas, es decir, el final de su última
  // palabra. No cuenta el espacio final, porque el documento lo estira más allá del margen y daría
  // un margen unos 2,5 puntos más ancho de la cuenta (se nota: el texto se iría desplazando).
  const derechas = usadas.slice(0, -1).map((l) => {
    const ultimo = l.chars.filter((ch) => ch.glifo && ch.c.trim() !== "").at(-1).glifo;
    return ultimo.origen[0] + ultimo.espaciado;
  });

  return {
    lineas: usadas,
    izquierda,
    ancho: Math.max(...derechas) - izquierda, // el ancho de la columna de texto
    yes: origenes.map((o) => o[1]), // la altura de cada línea original
    interlineado: origenes.length > 1 ? origenes[1][1] - origenes[0][1] : 12.75, // lo que baja de una a otra
  };
}

/**
 * Las letras del párrafo, todas seguidas como si fuera un solo renglón, con un espacio en cada
 * salto de línea. De cada letra se guarda además si va en negrita, que es lo que distingue los
 * datos del trabajador del texto corrido.
 */
function charsDelParrafo(lineas) {
  const chars = [];
  lineas.forEach((linea, i) => {
    if (i > 0 && chars.at(-1)?.c !== " ") chars.push({ ...linea.chars[0], c: " ", glifo: null });
    for (const ch of linea.chars) chars.push({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") });
  });
  return chars;
}

/**
 * En qué posición del párrafo empieza cada dato y cuántas letras ocupa. Se busca cada valor a
 * partir de donde acabó el anterior, para no confundirse si un número se repite.
 */
function posicionesDeGrupos(encontrado) {
  const posiciones = [];
  let desde = 0;
  for (const clave of CLAVES) {
    const valor = encontrado.groups[clave];
    const pos = encontrado[0].indexOf(valor, desde);
    if (pos < 0) throw new TA2NoRellenado(`no se localiza ${clave} en el párrafo.`);
    posiciones.push({ clave, inicio: encontrado.index + pos, largo: valor.length });
    desde = pos + valor.length;
  }
  return posiciones;
}

