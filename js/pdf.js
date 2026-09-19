// © 2026 Adrián Barroso de Cabo.
// Lógica principal: localiza las hojas, captura la firma digital y pega firma y sello.

import * as config from "./config.js";
import { FechaNoCambiada, leerHoja, ponerFechaEnPagina, recorrerTexto } from "./fecha.js";
import { cajaConTinta, decodificar, png, pngParaPdf, recortar } from "./imagenes.js";
import { interpretar, lineasDeGlifos, matrizDeAspecto, textoDeLineas } from "./lector.js";
import {
  ErrorProcesado,
  FirmaNoEncontrada,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  abrirPdf,
  anadirContenido,
  anadirRecurso,
  comoArray,
  comoNombre,
  comoNumero,
  guardar,
  incrustarImagen,
  invertir,
  leerStream,
  limites,
  multiplicar,
  numero,
  obtener,
  resolver,
  transformacion,
} from "./pdfbase.js";
import { renderizar } from "./render.js";
import { PDFObjectCopier } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

export { ErrorProcesado, FirmaNoEncontrada };

/**
 * Las tres hojas firmadas. Se preparan juntas en un único PDF (`conjunto`, que es el pack): así
 * comparten las fuentes y las imágenes, y dibujarlas o cambiarles la fecha es mucho más rápido. Cada
 * hoja suelta (`hoja.pdf`) se saca de él.
 */
export class Resultado {
  constructor(trabajador, desnudo, hojas, glifos, dni, puesto, firma, sello, sitios) {
    this.trabajador = trabajador;
    this.desnudoOriginal = desnudo; // las tres hojas sin firma ni sello, con la fecha original
    this.desnudo = desnudo; // igual, con la fecha elegida: es lo que se dibuja en la vista previa
    this.conjuntoOriginal = null; // las tres hojas terminadas con la fecha original
    this.conjunto = null; // las tres hojas terminadas como están ahora (el pack)
    this.sello = sello; // imagen del sello, o null
    this.sitios = sitios; // dónde va cada imagen en cada hoja (para dibujarlas en la vista previa)
    this.hojas = hojas; // [{ clave, titulo, paginaOrigen, pdfOriginal, pdf }]
    this.glifos = glifos;
    this.dni = dni;
    this.puesto = puesto; // p. ej. "AUXILIAR DE LIMPIEZA"
    this.firma = firma; // PNG de la firma que se ha pegado en las hojas
    this.fecha = null; // null: la fecha original del documento
    this.avisos = [];
    this.leidas = null; // lo leído de cada hoja para cambiarle la fecha (se lee la primera vez)
  }

  /** Pone `fecha` en todas las hojas, o la original si es null. Devuelve avisos de las que no se ha podido. */
  async ponerFecha(fecha) {
    this.fecha = fecha;
    this.avisos = [];
    const doc = await PDFDocument.load(this.desnudoOriginal, { updateMetadata: false });
    if (fecha) {
      this.leidas ??= doc.getPages().map((pagina) => leerHoja(doc, pagina));
      doc.getPages().forEach((pagina, i) => {
        try {
          ponerFechaEnPagina(doc, pagina, fecha, this.glifos, this.leidas[i]);
        } catch (error) {
          if (!(error instanceof FechaNoCambiada)) throw error;
          this.avisos.push(`${this.hojas[i].clave}: ${error.message}`);
        }
      });
      this.desnudo = await guardar(doc);
    } else {
      this.desnudo = this.desnudoOriginal;
    }
    // La firma y el sello se pegan ahora: así la vista previa puede dibujar las hojas sin ellos
    const firma = await incrustarImagen(doc, this.firma);
    const sello = this.sello ? await incrustarImagen(doc, this.sello) : null;
    doc.getPages().forEach((pagina, i) => {
      for (const sitio of this.sitios[i]) pegarImagen(doc, pagina, sitio.esSello ? sello : firma, sitio);
    });
    this.conjunto = await guardar(doc);
    const sueltas = await separar(this.conjunto);
    this.hojas.forEach((hoja, i) => (hoja.pdf = sueltas[i]));
    return this.avisos;
  }

  /** Las hojas tal cual, con la fecha original del documento (se preparan la primera vez que se piden). */
  async originales() {
    if (!this.conjuntoOriginal) {
      const fecha = this.fecha;
      await this.ponerFecha(null);
      this.conjuntoOriginal = this.conjunto;
      this.hojas.forEach((hoja) => (hoja.pdfOriginal = hoja.pdf));
      if (fecha) await this.ponerFecha(fecha);
    }
    return { conjunto: this.conjuntoOriginal, hojas: this.hojas.map((hoja) => hoja.pdfOriginal) };
  }

  /** Un único PDF con todas las hojas. */
  async pack() {
    return this.conjunto;
  }
}

/** Cada página de un PDF como un PDF aparte. */
async function separar(pdf) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return Promise.all(doc.getPageIndices().map(async (i) => {
    const suelta = await PDFDocument.create();
    const [pagina] = await suelta.copyPages(doc, [i]);
    suelta.addPage(pagina);
    return guardar(suelta);
  }));
}

/**
 * Separa y firma las hojas.
 * Con `imagenFirma` (PNG) se pega esa firma aunque el documento ya esté firmado; sin ella se usa
 * la firma digital del propio documento. `sello` es la imagen del sello de la empresa; sin ella
 * las hojas salen sin sello.
 */
export async function procesar(datos, { fecha = null, imagenFirma = null, sello = null } = {}) {
  const { doc, glifos, paginas, lineasDe, textoHojas, firmaDelDocumento } = await analizar(datos, { conFirma: !imagenFirma });
  const firma = imagenFirma ?? (await firmaDelDocumento());

  // Las tres hojas, copiadas de una vez para que compartan fuentes; la firma y el sello, una vez.
  // Sin anotaciones ni campos: la firma digital original no sería válida al separar las hojas.
  const conjunto = await PDFDocument.create();
  const anotaciones = Object.values(paginas).map((n) => [doc.getPage(n).node, doc.getPage(n).node.get(PDFName.of("Annots"))]);
  for (const [nodo] of anotaciones) nodo.delete(PDFName.of("Annots"));
  const copias = await conjunto.copyPages(doc, config.HOJAS.map((hoja) => paginas[hoja.clave]));
  for (const [nodo, valor] of anotaciones) if (valor !== undefined) nodo.set(PDFName.of("Annots"), valor);
  const tamanoFirma = await tamanoDeImagen(firma);
  const tamanoSello = sello ? await tamanoDeImagen(sello) : null;
  let trabajador = "";
  const sitios = config.HOJAS.map((hoja, i) => {
    const pagina = conjunto.addPage(copias[i]);
    const lineas = lineasDe[hoja.clave];
    const ancla = buscarAncla(conjunto, pagina, hoja.ladoAncla, lineas);
    if (hoja.clave === config.HOJA_NOMBRE) trabajador = nombreTrabajador(conjunto, pagina, ancla, lineas);
    const suyos = [sitioDeImagen(conjunto, pagina, tamanoFirma, hoja.firma, config.CAJA_FIRMA, ancla)];
    if (hoja.sello && tamanoSello) suyos.push({ ...sitioDeImagen(conjunto, pagina, tamanoSello, hoja.sello, config.CAJA_SELLO, ancla), esSello: true });
    return suyos;
  });
  const desnudoOriginal = await guardar(conjunto);

  const hojas = config.HOJAS.map((hoja) => ({
    clave: hoja.clave,
    titulo: hoja.titulo,
    paginaOrigen: paginas[hoja.clave] + 1,
    pdfOriginal: null,
    pdf: null,
  }));

  const resultado = new Resultado(
    nombreParaArchivo(trabajador) || "TRABAJADOR",
    desnudoOriginal,
    hojas,
    glifos,
    dniDelTexto(textoHojas),
    puestoDelTexto(textoHojas),
    firma,
    sello,
    sitios,
  );
  await resultado.ponerFecha(fecha);
  if (!fecha) await resultado.originales(); // sin fecha, lo que hay ya es el original
  return resultado;
}

const abiertos = new WeakMap(); // bytes del documento -> documento ya abierto
const analisis = new WeakMap(); // documento -> lo leído de él (se reaprovecha al repetir)

/** Abre el PDF una sola vez: al volver a generar las hojas se reaprovecha lo ya abierto. */
export async function abrirCacheado(datos) {
  if (!abiertos.has(datos)) abiertos.set(datos, await abrirPdf(datos));
  return abiertos.get(datos);
}

/**
 * Lee el documento laboral: sus letras, dónde están las hojas y (si se pide) la firma digital.
 * Se guarda lo leído: al volver a generar las hojas (al añadir el sello o cambiar la firma) no hay
 * que leer el documento otra vez.
 */
async function analizar(datos, { conFirma }) {
  const doc = await abrirCacheado(datos);
  if (!analisis.has(doc)) {
    const { glifos, textos, porPagina } = recorrerTexto(doc);
    const paginas = localizarHojas(doc, textos);
    // Las líneas de texto de cada hoja se sacan de lo ya leído: la copia de la página es idéntica
    const lineasDe = Object.fromEntries(Object.entries(paginas).map(([clave, n]) => [clave, lineasDeGlifos(porPagina[n])]));
    let capturada = null;
    analisis.set(doc, {
      doc,
      glifos,
      paginas,
      lineasDe,
      textoHojas: Object.values(lineasDe).map(textoDeLineas).join(" "),
      firmaDelDocumento: () => (capturada ??= capturarFirma(doc)),
    });
  }
  const info = analisis.get(doc);
  if (conFirma) info.firmaDelDocumento().catch(() => {}); // se va dibujando mientras tanto
  return info;
}

/** Texto de una página, línea a línea. */
export function textoPagina(doc, pagina) {
  return textoDeLineas(lineasDeGlifos(interpretar(doc, pagina).glifos));
}

/**
 * Ensayo con un PDF cualquiera de lo que se hace al procesar (leer el texto, dibujar, guardar con
 * imágenes), para que todo esté a punto antes del primer documento real.
 */
export async function calentar(datos, imagen) {
  const doc = await abrirPdf(datos);
  recorrerTexto(doc);
  textoPagina(doc, doc.getPage(0));
  const salida = await PDFDocument.create();
  const [pagina] = await salida.copyPages(doc, [0]);
  salida.addPage(pagina);
  const sitio = sitioDeImagen(salida, pagina, await tamanoDeImagen(imagen), { x: 0, y: 0 }, config.CAJA_FIRMA, null);
  pegarImagen(salida, pagina, await incrustarImagen(salida, imagen), sitio);
  const pdf = await guardar(salida);
  await renderizar(pdf, { escala: 0.3 });
  return pdf;
}

export function normalizar(texto) {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").toUpperCase().trim();
}

/**
 * Índice (base 0) de la página de cada hoja, buscándola por su título en todo el documento.
 * `textosPaginas` son los de `recorrerTexto` (si ya se tienen, no se vuelve a leer el documento).
 * Se compara sin espacios: así da igual cómo estén separadas las palabras en el PDF.
 */
export function localizarHojas(doc, textosPaginas = recorrerTexto(doc).textos) {
  const sinEspacios = (texto) => normalizar(texto).replace(/ /g, "");
  const textos = textosPaginas.map(sinEspacios);
  if (!textos.some(Boolean)) {
    throw new ErrorProcesado("El PDF no contiene texto (¿es un documento escaneado?), así que no se pueden localizar las hojas.");
  }
  const encontradas = {};
  const faltan = [];
  for (const hoja of config.HOJAS) {
    // Si el título aparece en varias páginas, gana la que lo tiene más arriba (su encabezado).
    let mejor = null;
    textos.forEach((texto, i) => {
      const posicion = texto.indexOf(sinEspacios(hoja.busqueda));
      if (posicion >= 0 && (!mejor || posicion < mejor.posicion)) mejor = { posicion, i };
    });
    if (mejor) encontradas[hoja.clave] = mejor.i;
    else faltan.push(hoja.titulo);
  }
  if (faltan.length) throw new ErrorProcesado(`No se encuentran estas hojas en el documento:\n\n- ${faltan.join("\n- ")}`);
  return encontradas;
}

/** Tipo de campo de un widget (puede heredarse del campo padre). */
function tipoDeCampo(doc, widget) {
  let actual = widget;
  for (let n = 0; actual instanceof PDFDict && n < 20; n++) {
    const tipo = comoNombre(obtener(doc, actual, "FT"));
    if (tipo) return tipo;
    actual = obtener(doc, actual, "Parent");
  }
  return undefined;
}

/** Campo de firma digital del documento (el último si hay varios), o null. */
export function campoFirma(doc) {
  let encontrado = null;
  doc.getPages().forEach((pagina, indice) => {
    for (const anotacion of comoArray(doc, pagina.node.get(PDFName.of("Annots"))) ?? []) {
      if (!(anotacion instanceof PDFDict)) continue;
      if (comoNombre(obtener(doc, anotacion, "Subtype")) !== "Widget") continue;
      if (tipoDeCampo(doc, anotacion) === "Sig") encontrado = { pagina, indice, widget: anotacion };
    }
  });
  return encontrado;
}

/** Aspecto visible (normal) de un widget: el stream que lo dibuja, o null. */
function aspectoDe(doc, widget) {
  let aspecto = obtener(doc, obtener(doc, widget, "AP"), "N");
  if (aspecto instanceof PDFDict && !(aspecto instanceof PDFStream)) {
    const estado = comoNombre(obtener(doc, widget, "AS"));
    aspecto = estado ? obtener(doc, aspecto, estado) : undefined;
  }
  return aspecto instanceof PDFStream ? aspecto : null;
}

/**
 * Dibuja con pdf.js un objeto (el aspecto de la firma o una imagen) solo, en un PDF aparte:
 * `contenido` son los operadores que lo dibujan como /Obj en una página del tamaño de `caja`.
 */
async function dibujarSolo(doc, objeto, caja, contenido, escala) {
  const temporal = await PDFDocument.create();
  const copia = PDFObjectCopier.for(doc.context, temporal.context).copy(objeto);
  const ref = temporal.context.register(copia);
  const pagina = temporal.addPage([caja[2] - caja[0], caja[3] - caja[1]]);
  pagina.setMediaBox(caja[0], caja[1], caja[2] - caja[0], caja[3] - caja[1]);
  pagina.node.set(PDFName.of("Resources"), temporal.context.obj({ XObject: { Obj: ref } }));
  pagina.node.set(PDFName.of("Contents"), temporal.context.register(temporal.context.flateStream(contenido)));
  return renderizar(await guardar(temporal), { escala, anotaciones: false });
}

/** PNG de la parte visible de la firma digital, recortando el blanco sobrante. */
export async function capturarFirma(doc) {
  const campo = campoFirma(doc);
  if (!campo) throw new FirmaNoEncontrada("No se ha encontrado la firma digital en el documento. ¿Seguro que está firmado?");
  const aspecto = aspectoDe(doc, campo.widget);
  const rect = comoArray(doc, obtener(doc, campo.widget, "Rect"))?.map(comoNumero);
  const matriz = aspecto && rect?.length === 4 ? matrizDeAspecto(doc, aspecto, rect) : null;
  if (!matriz) throw new ErrorProcesado("La firma digital no tiene una parte visible que se pueda copiar.");

  const caja = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const zoom = config.PPP_CAPTURA / 72;
  const imagen = await dibujarSolo(doc, aspecto, caja, `q ${matriz.map(numero).join(" ")} cm /Obj Do Q`, zoom);
  const tinta = cajaConTinta(imagen);
  if (!tinta) throw new ErrorProcesado("La firma digital no tiene una parte visible que se pueda copiar.");

  const margen = config.MARGEN_CAPTURA_PT * zoom;
  const recorte = [
    Math.max(0, Math.floor(tinta[0] - margen)),
    Math.max(0, Math.floor(tinta[1] - margen)),
    Math.min(imagen.ancho, Math.ceil(tinta[2] + margen)),
    Math.min(imagen.alto, Math.ceil(tinta[3] + margen)),
  ];
  return await png(recortar(imagen, recorte));
}

const TOLERANCIA_FIRMA = 14; // puntos de margen al buscar la firma pegada en una hoja ya hecha

/**
 * Firma pegada en una hoja ya hecha (INFO, EPI o REN), con el nombre y el DNI que figuran en ella.
 * Se reconoce por su posición: la que ocupa el sitio donde va la firma, no los logos ni el sello.
 */
export async function firmaDeHoja(doc) {
  for (const pagina of doc.getPages()) {
    const lectura = interpretar(doc, pagina);
    const lineas = lineasDeGlifos(lectura.glifos);
    const texto = textoDeLineas(lineas);
    const hoja = config.HOJAS.find((h) => normalizar(texto).includes(h.busqueda));
    if (!hoja) continue;
    const ancla = buscarAncla(doc, pagina, hoja.ladoAncla, lineas);
    if (!ancla) continue;

    const x = ancla[0] + hoja.firma.dx;
    const y = ancla[1] + hoja.firma.dy;
    const t = TOLERANCIA_FIRMA;
    const zona = [x - t, y - t, x + config.CAJA_FIRMA.ancho + t, y + config.CAJA_FIRMA.alto + t];
    let mejor = null;
    for (const imagen of lectura.imagenes) {
      if (!imagen.objeto) continue;
      const r = imagen.rect;
      const dentro = Math.max(0, Math.min(r[2], zona[2]) - Math.max(r[0], zona[0])) *
        Math.max(0, Math.min(r[3], zona[3]) - Math.max(r[1], zona[1]));
      const area = (r[2] - r[0]) * (r[3] - r[1]);
      const proporcion = area ? dentro / area : 0;
      if (proporcion > 0.6 && (!mejor || proporcion > mejor.proporcion)) mejor = { proporcion, imagen };
    }
    if (mejor) {
      return { imagen: await imagenAPng(doc, mejor.imagen.objeto), nombre: nombreDeLaFirma(doc, pagina, ancla, lineas), nif: identificadorDelTexto(texto) };
    }
  }
  return null;
}

/** PNG de una imagen del PDF a su tamaño real (un píxel por píxel de la imagen). */
async function imagenAPng(doc, objeto) {
  const ancho = comoNumero(obtener(doc, objeto, "Width")) ?? 1;
  const alto = comoNumero(obtener(doc, objeto, "Height")) ?? 1;
  const imagen = await dibujarSolo(doc, objeto, [0, 0, ancho, alto], `q ${ancho} 0 0 ${alto} 0 0 cm /Obj Do Q`, 1);
  return await png(imagen);
}

/** Quién firma la hoja: en EPI el nombre va a la derecha del "Fdo." y en INFO y REN, debajo. */
function nombreDeLaFirma(doc, pagina, ancla, lineas) {
  const util = (texto) => texto && !NIF_SUELTO.test(texto);
  for (const linea of lineas) {
    const mismaAltura = linea.bbox[1] < ancla[3] && linea.bbox[3] > ancla[1];
    if (!mismaAltura) continue;
    const texto = linea.chars.filter((ch) => ch.rect[0] > ancla[2]).map((ch) => ch.c).join("").trim();
    if (util(texto)) return texto;
  }
  const debajo = nombreTrabajador(doc, pagina, ancla, lineas);
  return util(debajo) ? debajo : "";
}

const NIF_SUELTO = /\b([XYZ]\d{7}[A-Z]|\d{8}[A-Z])\b/;

/** DNI del texto: primero con su etiqueta y, si no aparece así, el primer DNI suelto de la hoja. */
function identificadorDelTexto(texto) {
  return dniDelTexto(texto) || NIF_SUELTO.exec(texto.replace(/\s+/g, " "))?.[1]?.toUpperCase() || "";
}

const FIRMANTE = /Digitally signed by\s+(.+?)\s*-\s*NIF\s*:\s*([A-Z0-9]+)/i;
const DNI = /\bDNI(?:\/NIE)?\s*(?:n\s*[º°o]\.?)?\s*:?\s*([XYZ]?\d{7,8}[A-Z])\b/i;
const NO_RECORRER = new Set(["Page", "Pages", "Font", "FontDescriptor", "Catalog"]);

/** [nombre, NIF] de quien firmó, leídos del aspecto visible de la firma (["", ""] si no se sabe). */
export function firmante(doc) {
  const campo = campoFirma(doc);
  if (!campo) return ["", ""];
  const aspecto = obtener(doc, obtener(doc, campo.widget, "AP"), "N");
  if (!aspecto) return ["", ""];
  const coincidencia = FIRMANTE.exec(textosAspecto(doc, aspecto, new Set(), 0).join(" "));
  if (!coincidencia) return ["", ""];
  return [coincidencia[1].replace(/\s+/g, " ").trim(), coincidencia[2].toUpperCase()];
}

function textosAspecto(doc, valor, vistos, nivel) {
  if (nivel > 6) return [];
  const objeto = resolver(doc, valor);
  if (!objeto || vistos.has(objeto)) return [];
  vistos.add(objeto);
  const dict = objeto instanceof PDFStream ? objeto.dict : objeto;
  if (dict instanceof PDFDict && NO_RECORRER.has(comoNombre(obtener(doc, dict, "Type")))) return [];
  const textos = [];
  if (objeto instanceof PDFStream) {
    try {
      const contenido = new TextDecoder("latin1").decode(leerStream(objeto));
      for (const m of contenido.matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g)) textos.push(desescapar(m[1]));
    } catch {
      // stream que no se puede leer
    }
  }
  if (dict instanceof PDFDict) for (const [, v] of dict.entries()) textos.push(...textosAspecto(doc, v, vistos, nivel + 1));
  else if (objeto instanceof PDFArray) for (const v of objeto.asArray()) textos.push(...textosAspecto(doc, v, vistos, nivel + 1));
  return textos;
}

function desescapar(texto) {
  const especiales = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
  return texto.replace(/\\([0-7]{1,3}|[\s\S])/g, (_, g) =>
    /^[0-7]+$/.test(g) ? String.fromCharCode(parseInt(g, 8)) : (especiales[g] ?? g),
  );
}

const PUESTO = /puesto de trabajo\s+(?:de\s+)?(.+?)\s+en la empresa usuaria/i;

export function puestoDelTexto(texto) {
  const coincidencia = PUESTO.exec(texto.replace(/\s+/g, " "));
  return coincidencia ? coincidencia[1].trim() : "";
}

export function dniDelTexto(texto) {
  const coincidencia = DNI.exec(texto.replace(/\s+/g, " "));
  return coincidencia ? coincidencia[1].toUpperCase() : "";
}

export function nombreParaArchivo(texto) {
  return texto.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
}

/** Rectángulo del "Fdo." del lado indicado (el más bajo si hay varios), sin distinguir mayúsculas. */
export function buscarAncla(doc, pagina, lado, lineas = lineasDeGlifos(interpretar(doc, pagina).glifos)) {
  const [x0, , x1] = limites(doc, pagina);
  const mitad = (x0 + x1) / 2;
  const buscado = [...config.TEXTO_ANCLA.toLowerCase()];
  const encontrados = [];
  for (const { chars } of lineas) {
    for (let i = 0; i + buscado.length <= chars.length; i++) {
      if (!buscado.every((c, k) => chars[i + k].c.toLowerCase() === c)) continue;
      const rects = chars.slice(i, i + buscado.length).map((ch) => ch.rect);
      encontrados.push([
        Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])),
        Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3])),
      ]);
    }
  }
  return encontrados
    .filter((r) => (lado === "derecha" ? r[0] >= mitad : r[0] < mitad))
    .reduce((mejor, r) => (!mejor || r[1] > mejor[1] ? r : mejor), null);
}

/** Dónde va una imagen en la hoja: x, y, ancho y alto en puntos desde arriba a la izquierda. */
function sitioDeImagen(doc, pagina, tamano, colocacion, caja, ancla) {
  const escala = Math.min(caja.ancho / tamano.ancho, caja.alto / tamano.alto);
  const ancho = tamano.ancho * escala;
  const alto = tamano.alto * escala;
  const [bx0, by0, bx1, by1] = limites(doc, pagina);

  let x = ancla ? ancla[0] + colocacion.dx : colocacion.x;
  let y = ancla ? ancla[1] + colocacion.dy : colocacion.y;
  // Nunca fuera de la página, aunque el ancla esté muy abajo.
  x = Math.min(Math.max(x, bx0), bx1 - ancho);
  y = Math.min(Math.max(y, by0), by1 - alto);
  return { x, y, ancho, alto };
}

function pegarImagen(doc, pagina, imagen, sitio) {
  const nombre = anadirRecurso(doc, pagina, "XObject", "ImgFirmador", imagen.ref);
  const matriz = multiplicar([sitio.ancho, 0, 0, -sitio.alto, sitio.x, sitio.y + sitio.alto], invertir(transformacion(doc, pagina)));
  anadirContenido(doc, pagina, `q ${matriz.map(numero).join(" ")} cm /${nombre} Do Q`);
}

/** Tamaño en píxeles de una imagen (PNG o JPG). */
async function tamanoDeImagen(bytes) {
  const png = pngParaPdf(bytes);
  if (png) return { ancho: png.ancho, alto: png.alto };
  const imagen = await decodificar(bytes);
  return { ancho: imagen.ancho, alto: imagen.alto };
}

function nombreTrabajador(doc, pagina, ancla, lineas) {
  if (ancla) {
    const [, , x1] = limites(doc, pagina);
    const zona = [ancla[0] - 2, ancla[3], x1 - 20, ancla[3] + 30];
    for (const linea of lineas) {
      const texto = linea.chars
        .filter(({ rect }) => {
          const cx = (rect[0] + rect[2]) / 2;
          const cy = (rect[1] + rect[3]) / 2;
          return cx >= zona[0] && cx <= zona[2] && cy >= zona[1] && cy <= zona[3];
        })
        .map((ch) => ch.c)
        .join("")
        .trim();
      if (texto) return texto;
    }
  }
  const coincidencia = /D\.\s*\/\s*Dña\.\s*:?\s*([\s\S]+?)\s+persona trabajadora/.exec(textoDeLineas(lineas));
  return coincidencia ? coincidencia[1] : "";
}
