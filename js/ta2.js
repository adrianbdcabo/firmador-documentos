// © 2026 Adrián Barroso de Cabo.
// Rellenar un TA2 (informe de situación de alta de la Seguridad Social) con los datos del
// trabajador del documento laboral cargado: nombre, fecha de nacimiento, NAF y DNI/NIE.
//
// El párrafo de datos no se "parchea": se borra entero y se vuelve a componer justificado con las
// fuentes del propio PDF (sus glifos, por número), el mismo margen, interlineado y reparto de
// espacios, de modo que el resultado es indistinguible de cómo lo escribe el propio documento. Si
// el nombre nuevo hace que el párrafo ocupe una línea más (o menos), el párrafo siguiente baja o
// sube, igual que en los informes reales.
//
// El documento que sale NO lleva la codificación informática (referencia, fecha, hora y huella)
// del original, porque esa codificación certifica los datos de otra persona: se deja en blanco y
// se avisa en el pie de que es una copia de prueba sin validez.

import { quitarGlifos, recorrerTexto } from "./fecha.js";
import { interpretar, lineasDeGlifos } from "./lector.js";
import {
  PDFDict, PDFName, PDFRef, PDFStream,
  abrirPdf, anadirContenido, anadirRecurso, aPdf, cambiarContenido, comoArray, comoNombre,
  guardar, heredado, nombreBase, numero, obtener, resolver,
} from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

// El párrafo del TA2: "… de D./Dña. NOMBRE, con fecha de nacimiento …, con número de afiliación … y DNI …,"
const PATRON = /D\.\/Dña\.\s+(?<nombre>[^,]+?)\s*,\s*con fecha de nacimiento\s+(?<nacimiento>\d{1,2}\/\d{1,2}\/\d{4})\s*,\s*con número de afiliación\s+(?<naf>\d{2}\s?\d{10})\s*y\s*(?<tipo>DNI|NIE)\s+(?<documento>[0-9A-Za-z]{8,12})\s*,/u;
// La hoja INFO del documento laboral, que es la que trae el NAF y la fecha de nacimiento.
const PATRON_LABORAL = /trabajador\/a\s+(?<nombre>.+?)\s+con\s+N\.I\.F\.\/N\.I\.E\.\/Pasaporte:\s*(?<documento>[0-9A-Za-z]+)\s*,.{0,40}?Afilici[oó]n a la Seg\. Soc\.:\s*(?<naf>\d+)\s*y fecha de nacimiento:\s*(?<nacimiento>\d{1,2}[-/]\d{1,2}[-/]\d{4})/su;
const CLAVES = ["nombre", "nacimiento", "naf", "tipo", "documento"];
const AVISO = "Copia de prueba: sin la codificación informática de la Seguridad Social este documento no tiene validez.";

export class TA2NoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "TA2NoRellenado";
  }
}

/** Un TA2 con los datos del trabajador del documento laboral. Devuelve los bytes del PDF. */
export async function generarTA2(plantilla, docLaboral) {
  const doc = await abrirPdf(plantilla);
  const resultado = await rellenarTA2(doc, datosDelLaboral(docLaboral));
  return { pdf: await guardar(doc), ...resultado };
}

/** Nombre, documento, NAF y fecha de nacimiento del trabajador del documento laboral. */
export function datosDelLaboral(doc) {
  for (const pagina of doc.getPages()) {
    const lineas = lineasDeGlifos(interpretar(doc, pagina).glifos);
    const texto = lineas.map((l) => l.chars.map((ch) => ch.c).join("")).join(" ").replace(/\s+/g, " ");
    const encontrado = PATRON_LABORAL.exec(texto);
    if (encontrado) return { ...encontrado.groups, nombre: nombreDirecto(encontrado.groups.nombre) };
  }
  throw new TA2NoRellenado("el documento laboral no trae el NAF y la fecha de nacimiento del trabajador.");
}

/** "OSAFAMEN, CINTHIA" -> "CINTHIA OSAFAMEN" (como lo escribe la Seguridad Social). */
export function nombreDirecto(nombre) {
  const partes = nombre.split(",");
  const texto = partes.length < 2 ? nombre : `${partes[1]} ${partes[0]}`;
  return texto.replace(/\s+/g, " ").trim();
}

/** El número de documento como lo escribe la Seguridad Social: 10 caracteres con ceros delante. */
export function documentoFormateado(documento) {
  const limpio = documento.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return { tipo: /^[XYZ]/.test(limpio) ? "NIE" : "DNI", valor: limpio.padStart(10, "0") };
}

/** "281548815306" -> "28 1548815306" */
export function nafFormateado(naf) {
  const limpio = naf.replace(/\D/g, "").padStart(12, "0");
  return `${limpio.slice(0, 2)} ${limpio.slice(2)}`;
}

export function fechaBarras(texto) {
  const partes = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(texto);
  if (!partes) throw new TA2NoRellenado(`fecha de nacimiento no reconocida: ${texto}`);
  return `${partes[1].padStart(2, "0")}/${partes[2].padStart(2, "0")}/${partes[3]}`;
}

/**
 * Cambia en el TA2 (documento ya abierto) los datos del trabajador por los de `datos`.
 */
export async function rellenarTA2(doc, datos, { aviso = true } = {}) {
  const pagina = doc.getPage(0);
  const { glifos: mapas } = recorrerTexto(doc);
  const respaldo = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const lectura = interpretar(doc, pagina);
  const lineas = lineasDeGlifos(lectura.glifos);

  const parrafo = localizarParrafo(lineas);
  const chars = charsDelParrafo(parrafo.lineas);
  const texto = chars.map((ch) => ch.c).join("");
  const encontrado = PATRON.exec(texto);
  if (!encontrado) throw new TA2NoRellenado("no se reconoce el párrafo de datos del trabajador.");

  const documento = documentoFormateado(datos.documento);
  const valores = {
    nombre: datos.nombre.replace(/\s+/g, " ").trim(),
    nacimiento: fechaBarras(datos.nacimiento),
    naf: nafFormateado(datos.naf),
    tipo: documento.tipo,
    documento: documento.valor,
  };

  // Sustituir de atrás hacia delante para no mover los índices de los grupos anteriores.
  let nuevos = chars;
  for (const grupo of posicionesDeGrupos(encontrado).reverse()) {
    const modelo = nuevos[grupo.inicio];
    const reemplazo = [...valores[grupo.clave]].map((c) => ({ ...modelo, c, glifo: null }));
    nuevos = [...nuevos.slice(0, grupo.inicio), ...reemplazo, ...nuevos.slice(grupo.inicio + grupo.largo)];
  }

  const medida = { mapas, respaldo };
  const colocadas = repartirEnLineas(enPalabras(nuevos, medida), parrafo, medida);
  const lineasNuevas = colocadas.length;
  const borrar = new Set(chars.map((ch) => ch.glifo).filter(Boolean));

  // Si el párrafo pasa a ocupar más (o menos) líneas, el siguiente baja o sube igual que en los
  // informes reales, que dejan siempre una línea en blanco entre los dos.
  const desplazamiento = (lineasNuevas - parrafo.lineas.length) * parrafo.interlineado;
  if (desplazamiento !== 0) {
    const siguiente = lineas.find((l) => textoDe(l).trimStart().startsWith("La fecha de efectos"));
    if (!siguiente) throw new TA2NoRellenado("no se encuentra el párrafo de la fecha de efectos.");
    for (const ch of siguiente.chars) if (ch.glifo) borrar.add(ch.glifo);
    colocadas.push(palabrasColocadas(siguiente, desplazamiento, medida));
  }

  for (const glifo of glifosDeCodificacion(lineas)) borrar.add(glifo);
  if ([...borrar].some((glifo) => !glifo.editable)) throw new TA2NoRellenado("el párrafo no se puede modificar.");
  cambiarContenido(doc, pagina, quitarGlifos(lectura, borrar));
  escribir(doc, pagina, colocadas, medida);
  if (aviso) ponerAviso(doc, pagina, respaldo.negrita);
  return { lineasOriginales: parrafo.lineas.length, lineasNuevas, desplazamiento, valores };
}

/** Las palabras de una línea que no cambia, en su mismo sitio pero `desplazamiento` más abajo. */
function palabrasColocadas(linea, desplazamiento, medida) {
  const chars = linea.chars.map((ch) => ({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") }));
  return enPalabras(chars, medida).map((palabra) => {
    const primero = palabra.chars.find((ch) => ch.glifo);
    return { ...palabra, x: primero.glifo.origen[0], y: primero.glifo.origen[1] + desplazamiento };
  });
}

/** Los valores del recuadro de codificación informática (referencia, fecha, hora y huella). */
function glifosDeCodificacion(lineas) {
  const glifos = [];
  for (const linea of lineas) {
    const primero = linea.chars.find((ch) => ch.glifo);
    if (!primero || primero.glifo.origen[1] < 700) continue; // solo el pie de la página
    if (!/^(T\d{10,14}|\d{2}[-/]\d{2}[-/]\d{4}|\d{2}:\d{2}:\d{2}|[A-Z0-9]{8})$/.test(textoDe(linea).trim())) continue;
    for (const ch of linea.chars) if (ch.glifo) glifos.push(ch.glifo);
  }
  return glifos;
}

/** El aviso del pie: sin él, el documento podría confundirse con el original de otra persona. */
function ponerAviso(doc, pagina, fuente) {
  const nombre = anadirRecurso(doc, pagina, "Font", "FAviso", fuente.ref);
  anadirContenido(doc, pagina, `q BT 0.8 0.1 0.1 rg /${nombre} 8 Tf 1 0 0 1 60 128 Tm (${AVISO.replace(/([\\()])/g, "\\$1")}) Tj ET Q`);
}

// ------------------------------------------------------------------ lectura del párrafo

const textoDe = (linea) => linea.chars.map((ch) => ch.c).join("");

function localizarParrafo(lineas) {
  const inicio = lineas.findIndex((l) => textoDe(l).includes("ha procedido a reconocer"));
  if (inicio < 0) throw new TA2NoRellenado("no se encuentra el párrafo del alta.");
  const usadas = [];
  let acumulado = "";
  for (let i = inicio; i < Math.min(inicio + 6, lineas.length); i++) {
    usadas.push(lineas[i]);
    acumulado += (acumulado ? " " : "") + textoDe(lineas[i]).trim();
    if (/cotización/.test(acumulado) && /\.\s*$/.test(acumulado)) break;
  }
  const origenes = usadas.map((l) => l.chars.find((ch) => ch.glifo).glifo.origen);
  const izquierda = Math.min(...origenes.map((o) => o[0]));
  // El margen derecho es donde terminan las líneas justificadas, sin contar el espacio final
  // (que el documento estira más allá del margen).
  const derechas = usadas.slice(0, -1).map((l) => {
    const ultimo = l.chars.filter((ch) => ch.glifo && ch.c.trim() !== "").at(-1).glifo;
    return ultimo.origen[0] + ultimo.espaciado;
  });
  return {
    lineas: usadas,
    izquierda,
    ancho: Math.max(...derechas) - izquierda,
    yes: origenes.map((o) => o[1]),
    interlineado: origenes.length > 1 ? origenes[1][1] - origenes[0][1] : 12.75,
  };
}

/** Las letras del párrafo seguidas, con un espacio en cada salto de línea. */
function charsDelParrafo(lineas) {
  const chars = [];
  lineas.forEach((linea, i) => {
    if (i > 0 && chars.at(-1)?.c !== " ") chars.push({ ...linea.chars[0], c: " ", glifo: null });
    for (const ch of linea.chars) chars.push({ ...ch, negrita: nombreBase(ch.fuente).includes("Bold") });
  });
  return chars;
}

/** Dónde empieza cada dato dentro del texto del párrafo. */
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
 * Ancho de una letra: el del propio PDF si su fuente la trae, y si no el de la Helvetica de
 * respaldo (de la misma anchura que Arial), que es con la que se va a dibujar.
 */
function anchoChar(ch, { mapas, respaldo }) {
  const glifo = mapas[nombreBase(ch.fuente)]?.[ch.c];
  if (glifo) return glifo.avance * ch.tamano;
  const fuente = ch.negrita ? respaldo.negrita : respaldo.normal;
  try {
    return fuente.widthOfTextAtSize(ch.c, ch.tamano);
  } catch {
    return 0.556 * ch.tamano;
  }
}

function enPalabras(chars, medida) {
  const palabras = [];
  let actual = null;
  for (const ch of chars) {
    if (ch.c === " ") {
      actual = null;
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

/** Reparte las palabras en líneas justificadas del mismo ancho, altura y separación que las originales. */
function repartirEnLineas(palabras, parrafo, medida) {
  const modelo = palabras[0]?.chars[0];
  const espacio = anchoChar({ ...modelo, c: " ", negrita: false }, medida) || 0.278 * (modelo?.tamano ?? 9);
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

  return lineas.map((linea, i) => {
    const suma = linea.palabras.reduce((total, p) => total + p.ancho, 0);
    const huecos = linea.palabras.length - 1;
    const ultima = i === lineas.length - 1;
    // Los espacios de la línea se estiran por igual hasta llegar al margen, como en el original.
    const sobra = ultima || huecos <= 0 ? 0 : parrafo.ancho - suma - espacio * huecos;
    const estirar = huecos > 0 ? sobra / huecos : 0;
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

/** Referencia a la fuente `base` de la página si se puede escribir con ella por número de glifo. */
function fuenteIdentityH(doc, pagina, base) {
  const fuentes = obtener(doc, heredado(doc, pagina.node, "Resources"), "Font");
  if (!(fuentes instanceof PDFDict)) return null;
  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    const nombre = comoNombre(obtener(doc, fuente, "BaseFont"));
    if (!nombre || nombreBase(nombre) !== base) continue;
    if (comoNombre(obtener(doc, fuente, "Subtype")) !== "Type0" || comoNombre(obtener(doc, fuente, "Encoding")) !== "Identity-H") continue;
    const descendiente = resolver(doc, comoArray(doc, obtener(doc, fuente, "DescendantFonts"))?.[0]);
    const mapa = obtener(doc, descendiente, "CIDToGIDMap");
    if (mapa instanceof PDFStream) continue;
    if (mapa !== undefined && !(mapa instanceof PDFName && mapa.decodeText() === "Identity")) continue;
    return valor instanceof PDFRef ? valor : doc.context.register(fuente);
  }
  return null;
}

function escribir(doc, pagina, lineas, { mapas, respaldo }) {
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

  const operadores = ["q BT 0 Tc 0 Tw 0 Ts 0 Tr 100 Tz"];
  let colorActual = null;
  for (const linea of lineas) {
    for (const palabra of linea) {
      let x = palabra.x;
      let trozo = null;
      const trozos = [];
      for (const ch of palabra.chars) {
        const base = nombreBase(ch.fuente);
        const propio = Boolean(mapas[base]?.[ch.c]);
        if (!trozo || trozo.base !== base || trozo.propio !== propio) {
          trozo = { base, propio, negrita: ch.negrita, tamano: ch.tamano, color: ch.color, x, chars: [] };
          trozos.push(trozo);
        }
        trozo.chars.push(ch);
        x += anchoChar(ch, { mapas, respaldo });
      }
      for (const t of trozos) {
        const fuente = fuenteDe(t.base, t.propio, t.negrita);
        const [px, py] = aPdf(doc, pagina, [t.x, palabra.y]);
        const color = (t.color?.length === 3 ? t.color : [0, 0, 0]).map(numero).join(" ");
        if (color !== colorActual) {
          operadores.push(`${color} rg`);
          colorActual = color;
        }
        const texto = fuente.propia
          ? `<${t.chars.map((ch) => mapas[t.base][ch.c].gid.toString(16).padStart(4, "0")).join("")}>`
          : `(${t.chars.map((ch) => ch.c).join("").replace(/([\\()])/g, "\\$1")})`;
        operadores.push(`/${fuente.nombre} ${numero(t.tamano)} Tf 1 0 0 1 ${numero(px)} ${numero(py)} Tm ${texto} Tj`);
      }
    }
  }
  operadores.push("ET Q");
  anadirContenido(doc, pagina, operadores.join("\n"));
}
