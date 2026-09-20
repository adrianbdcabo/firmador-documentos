// © 2026 Adrián Barroso de Cabo.
// Rellenar un TA2 (informe de situación de alta de la Seguridad Social) con los datos del
// trabajador del documento laboral cargado: nombre, fecha de nacimiento, NAF y DNI/NIE.
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

import { quitarGlifos, recorrerTexto } from "./fecha.js";
import { interpretar, lineasDeGlifos } from "./lector.js";
import {
  PDFDict, PDFName, PDFRef, PDFStream,
  abrirPdf, anadirContenido, anadirRecurso, aPdf, cambiarContenido, comoArray, comoNombre,
  guardar, heredado, nombreBase, numero, obtener, resolver,
} from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

// El párrafo del TA2, con los cuatro datos entre paréntesis para poder sustituirlos por separado:
// "… de D./Dña. NOMBRE, con fecha de nacimiento 07/02/2006, con número de afiliación 28 1501917624 y DNI 072008038Y,"
const PATRON = /D\.\/Dña\.\s+(?<nombre>[^,]+?)\s*,\s*con fecha de nacimiento\s+(?<nacimiento>\d{1,2}\/\d{1,2}\/\d{4})\s*,\s*con número de afiliación\s+(?<naf>\d{2}\s?\d{10})\s*y\s*(?<tipo>DNI|NIE)\s+(?<documento>[0-9A-Za-z]{8,12})\s*,/u;
// La frase de la hoja INFO del documento laboral, que es la única que trae el NAF y el nacimiento:
// "El/La trabajador/a OSAFAMEN, CINTHIA con N.I.F./N.I.E./Pasaporte: Y6912244E, Nº Afilición a la
//  Seg. Soc.:281548815306 y fecha de nacimiento:16-02-1994"  ("Afilición" está así en el original).
const PATRON_LABORAL = /trabajador\/a\s+(?<nombre>.+?)\s+con\s+N\.I\.F\.\/N\.I\.E\.\/Pasaporte:\s*(?<documento>[0-9A-Za-z]+)\s*,.{0,40}?Afilici[oó]n a la Seg\. Soc\.:\s*(?<naf>\d+)\s*y fecha de nacimiento:\s*(?<nacimiento>\d{1,2}[-/]\d{1,2}[-/]\d{4})/su;
// Los cuatro datos, en el mismo orden en que aparecen en el párrafo (importa para sustituirlos).
const CLAVES = ["nombre", "nacimiento", "naf", "tipo", "documento"];

/** Error con mensaje en español: lo recoge app.js y lo enseña en un aviso. */
export class TA2NoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "TA2NoRellenado";
  }
}

/**
 * Lo que llama el botón "TA2 del trabajador": coge la plantilla y el documento laboral ya abierto,
 * y devuelve los bytes del PDF listo para descargar.
 */
export async function generarTA2(plantilla, docLaboral) {
  const doc = await abrirPdf(plantilla);
  const resultado = await rellenarTA2(doc, datosDelLaboral(docLaboral));
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
    if (encontrado) return { ...encontrado.groups, nombre: nombreDirecto(encontrado.groups.nombre) };
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
export async function rellenarTA2(doc, datos) {
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

  // (8) Si el párrafo pasa a ocupar más (o menos) líneas, el párrafo siguiente ("La fecha de
  //     efectos…") baja o sube lo mismo, para que quede la línea en blanco de siempre entre los
  //     dos. Se borra de su sitio y se vuelve a dibujar más abajo o más arriba, sin tocar su texto.
  const desplazamiento = (lineasNuevas - parrafo.lineas.length) * parrafo.interlineado;
  if (desplazamiento !== 0) {
    const siguiente = lineas.find((l) => textoDe(l).trimStart().startsWith("La fecha de efectos"));
    if (!siguiente) throw new TA2NoRellenado("no se encuentra el párrafo de la fecha de efectos.");
    for (const ch of siguiente.chars) if (ch.glifo) borrar.add(ch.glifo);
    colocadas.push(palabrasColocadas(siguiente, desplazamiento, medida));
  }

  // (9) Y también las cuatro casillas de la codificación informática del pie.
  // for (const glifo of glifosDeCodificacion(lineas)) borrar.add(glifo);

  // (10) Borrar de verdad y escribir lo nuevo encima. `quitarGlifos` devuelve el contenido de la
  //      página sin esas letras (todo lo demás —líneas, recuadros, logos— queda intacto).
  if ([...borrar].some((glifo) => !glifo.editable)) throw new TA2NoRellenado("el párrafo no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));
  escribir(doc, pagina, colocadas, medida);

  return { lineasOriginales: parrafo.lineas.length, lineasNuevas, desplazamiento, valores };
}

/**
 * Las palabras de una línea que no cambia de texto, en su misma posición pero `desplazamiento`
 * puntos más abajo (o más arriba, si el número es negativo).
 */
function palabrasColocadas(linea, desplazamiento, medida) {
  const chars = linea.chars.map((ch) => ({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") }));
  return enPalabras(chars, medida).map((palabra) => {
    const primero = palabra.chars.find((ch) => ch.glifo);
    return { ...palabra, x: primero.glifo.origen[0], y: primero.glifo.origen[1] + desplazamiento };
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

// ------------------------------------------------------------------ medidas y reparto

/**
 * Lo que ocupa una letra, en puntos. Si su fuente está en el PDF se usa la anchura que trae el
 * propio documento; si no (una Ñ que el original no usa, por ejemplo), la de la Helvetica de
 * repuesto, que es con la que se va a dibujar. Medir y dibujar con la misma fuente es lo que
 * garantiza que las palabras caigan donde se ha calculado.
 */
function anchoChar(ch, { mapas, respaldo }) {
  const glifo = mapas[nombreBase(ch.fuente)]?.[ch.c];
  if (glifo) return glifo.avance * ch.tamano;
  const fuente = ch.negrita ? respaldo.negrita : respaldo.normal;
  try {
    return fuente.widthOfTextAtSize(ch.c, ch.tamano);
  } catch {
    return 0.556 * ch.tamano; // letra rarísima que ni siquiera tiene la Helvetica: ancho medio
  }
}

/** Agrupa las letras en palabras (se corta en cada espacio) y mide lo que ocupa cada una. */
function enPalabras(chars, medida) {
  const palabras = [];
  let actual = null;
  for (const ch of chars) {
    if (ch.c === " ") {
      actual = null; // el espacio cierra la palabra; su ancho se calcula luego al justificar
      continue;
    }
    if (!actual) {
      actual = { chars: [], ancho: 0 };
      palabras.push(actual);
    }
    actual.chars.push(ch);
    actual.ancho += anchoChar(ch, medida);
  }
  for (const palabra of palabras) palabra.texto = palabra.chars.map((ch) => ch.c).join("");
  return palabras;
}

/**
 * Reparte las palabras en líneas y calcula la posición exacta de cada una, igual que hace el
 * programa de la Seguridad Social: se van metiendo palabras hasta que no cabe otra, y entonces el
 * hueco que sobra hasta el margen derecho se reparte por igual entre todos los espacios de esa
 * línea. La última línea no se estira: va con espacios normales.
 */
function repartirEnLineas(palabras, parrafo, medida) {
  const modelo = palabras[0]?.chars[0];
  // El ancho del espacio, medido con la misma fuente del documento (son 2,49 puntos a cuerpo 9).
  const espacio = anchoChar({ ...modelo, c: " ", negrita: false }, medida) || 0.278 * (modelo?.tamano ?? 9);

  // Repartir las palabras: cada línea acepta palabras mientras no se pase del ancho de la columna.
  const lineas = [];
  let actual = { palabras: [], ancho: 0 };
  for (const palabra of palabras) {
    const ancho = actual.palabras.length ? actual.ancho + espacio + palabra.ancho : palabra.ancho;
    if (actual.palabras.length && ancho > parrafo.ancho + 0.01) {
      lineas.push(actual);
      actual = { palabras: [palabra], ancho: palabra.ancho };
    } else {
      actual.palabras.push(palabra);
      actual.ancho = ancho;
    }
  }
  if (actual.palabras.length) lineas.push(actual);

  // Y ahora, la posición de cada palabra dentro de su línea.
  return lineas.map((linea, i) => {
    const suma = linea.palabras.reduce((total, p) => total + p.ancho, 0);
    const huecos = linea.palabras.length - 1;
    const ultima = i === lineas.length - 1;
    // Lo que sobra hasta el margen se reparte entre los huecos (en la última línea, nada).
    const sobra = ultima || huecos <= 0 ? 0 : parrafo.ancho - suma - espacio * huecos;
    const estirar = huecos > 0 ? sobra / huecos : 0;
    // Altura: la de la línea original si existe y, si el párrafo ha crecido, una más abajo.
    const y = i < parrafo.yes.length ? parrafo.yes[i] : parrafo.yes.at(-1) + parrafo.interlineado * (i - parrafo.yes.length + 1);
    let x = parrafo.izquierda;
    return linea.palabras.map((palabra, k) => {
      if (k > 0) x += espacio + estirar;
      const colocada = { ...palabra, x, y };
      x += palabra.ancho;
      return colocada;
    });
  });
}

// ------------------------------------------------------------------ escritura

/**
 * Busca en la página la fuente que se llama `base` (ArialMT, Arial-BoldMT…) y devuelve una
 * referencia a ella, pero solo si se puede escribir pidiéndole las letras por su número de glifo
 * (fuentes "Type0" con codificación "Identity-H", que es como las mete este PDF). Si la fuente es
 * de otro tipo devuelve null y se tira de la Helvetica de repuesto.
 */
function fuenteIdentityH(doc, pagina, base) {
  const fuentes = obtener(doc, heredado(doc, pagina.node, "Resources"), "Font");
  if (!(fuentes instanceof PDFDict)) return null;
  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    const nombre = comoNombre(obtener(doc, fuente, "BaseFont"));
    if (!nombre || nombreBase(nombre) !== base) continue;
    if (comoNombre(obtener(doc, fuente, "Subtype")) !== "Type0" || comoNombre(obtener(doc, fuente, "Encoding")) !== "Identity-H") continue;
    // CIDToGIDMap "Identity" significa que el número que se escribe es directamente el del glifo;
    // si el PDF trae otra tabla de conversión, mejor no arriesgarse y usar la fuente de repuesto.
    const descendiente = resolver(doc, comoArray(doc, obtener(doc, fuente, "DescendantFonts"))?.[0]);
    const mapa = obtener(doc, descendiente, "CIDToGIDMap");
    if (mapa instanceof PDFStream) continue;
    if (mapa !== undefined && !(mapa instanceof PDFName && mapa.decodeText() === "Identity")) continue;
    return valor instanceof PDFRef ? valor : doc.context.register(fuente);
  }
  return null;
}

/**
 * Dibuja en la página las palabras ya colocadas. Un PDF no guarda "texto" sino instrucciones de
 * dibujo, así que se genera una lista de operadores:
 *   q … Q        abre y cierra el bloque, para no alterar nada de lo que ya había
 *   BT … ET      empieza y termina el texto
 *   /F 9 Tf      usa la fuente F a cuerpo 9
 *   1 0 0 1 x y Tm   coloca la pluma en el punto (x, y)
 *   <0044…> Tj   escribe esas letras (en hexadecimal, por número de glifo)
 *   (texto) Tj   escribe esas letras (texto normal, con la fuente de repuesto)
 * Cada palabra se coloca con su propio Tm, que es justamente como lo hace el documento original.
 */
function escribir(doc, pagina, lineas, { mapas, respaldo }) {
  // Las fuentes se añaden a la página una sola vez y se reutiliza su nombre (/FTa1, /FTa2…).
  const recursos = new Map();
  const fuenteDe = (base, propia, negrita) => {
    const clave = propia ? base : `respaldo-${negrita ? "b" : "n"}`;
    if (!recursos.has(clave)) {
      const ref = propia ? fuenteIdentityH(doc, pagina, base) : null;
      const valor = ref ?? (negrita ? respaldo.negrita : respaldo.normal).ref;
      recursos.set(clave, { nombre: anadirRecurso(doc, pagina, "Font", "FTa", valor), propia: Boolean(ref) });
    }
    return recursos.get(clave);
  };

  // Se parte de un estado de texto limpio: sin espaciado extra entre letras ni palabras (Tc, Tw),
  // sin subir ni bajar la línea base (Ts), en modo de relleno normal (Tr) y sin estrechar (Tz).
  const operadores = ["q BT 0 Tc 0 Tw 0 Ts 0 Tr 100 Tz"];
  let colorActual = null;
  for (const linea of lineas) {
    for (const palabra of linea) {
      // Una palabra puede necesitar varios trozos: cambia de fuente (negrita a normal) o tiene
      // alguna letra que no está en el PDF y hay que sacar de la Helvetica de repuesto. Cada trozo
      // se dibuja por separado, y se va llevando la cuenta de la x para saber dónde empieza cada uno.
      let x = palabra.x;
      let trozo = null;
      const trozos = [];
      for (const ch of palabra.chars) {
        const base = nombreBase(ch.fuente);
        const propio = Boolean(mapas[base]?.[ch.c]); // ¿la trae el propio PDF?
        if (!trozo || trozo.base !== base || trozo.propio !== propio) {
          trozo = { base, propio, negrita: ch.negrita, tamano: ch.tamano, color: ch.color, x, chars: [] };
          trozos.push(trozo);
        }
        trozo.chars.push(ch);
        x += anchoChar(ch, { mapas, respaldo });
      }

      for (const t of trozos) {
        const fuente = fuenteDe(t.base, t.propio, t.negrita);
        // Las posiciones se llevan en coordenadas de pantalla (origen arriba a la izquierda) y
        // `aPdf` las pasa a las del PDF (origen abajo a la izquierda).
        const [px, py] = aPdf(doc, pagina, [t.x, palabra.y]);
        const color = (t.color?.length === 3 ? t.color : [0, 0, 0]).map(numero).join(" ");
        if (color !== colorActual) {
          operadores.push(`${color} rg`); // solo se repite la orden de color cuando cambia
          colorActual = color;
        }
        const texto = fuente.propia
          // Con la fuente del PDF: cada letra es su número de glifo en cuatro cifras hexadecimales.
          ? `<${t.chars.map((ch) => mapas[t.base][ch.c].gid.toString(16).padStart(4, "0")).join("")}>`
          // Con la de repuesto: texto normal, protegiendo los caracteres que el PDF usa como suyos.
          : `(${t.chars.map((ch) => ch.c).join("").replace(/([\\()])/g, "\\$1")})`;
        operadores.push(`/${fuente.nombre} ${numero(t.tamano)} Tf 1 0 0 1 ${numero(px)} ${numero(py)} Tm ${texto} Tj`);
      }
    }
  }
  operadores.push("ET Q");
  anadirContenido(doc, pagina, operadores.join("\n"));
}
