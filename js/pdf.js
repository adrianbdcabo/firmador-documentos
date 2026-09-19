// © 2026 Adrián Barroso de Cabo. Licencia AGPL-3.0 (ver LICENSE).
// Lógica principal: localiza las hojas, captura la firma digital y pega firma y sello.

import * as config from "./config.js";
import { FechaNoCambiada, cambiarFecha, recorrerTexto } from "./fecha.js";
import {
  ErrorProcesado,
  FirmaNoEncontrada,
  abrirPdf,
  anadirContenido,
  anadirRecurso,
  cajaConTinta,
  guardar,
  lineasDeTexto,
  mupdf,
  numero,
  rectDeQuad,
  renderRecorte,
  textoPagina,
} from "./pdfutil.js";

export { ErrorProcesado, FirmaNoEncontrada };

export class Resultado {
  constructor(trabajador, hojas, glifos, dni, puesto, firma) {
    this.trabajador = trabajador;
    this.hojas = hojas; // [{ clave, titulo, paginaOrigen, pdfOriginal, pdf }]
    this.glifos = glifos;
    this.dni = dni;
    this.puesto = puesto; // p. ej. "AUXILIAR DE LIMPIEZA"
    this.firma = firma; // PNG de la firma que se ha pegado en las hojas
    this.fecha = null; // null: la fecha original del documento
    this.avisos = [];
  }

  /** Pone `fecha` en todas las hojas, o la original si es null. Devuelve avisos de las que no se ha podido. */
  ponerFecha(fecha) {
    this.fecha = fecha;
    this.avisos = [];
    for (const hoja of this.hojas) {
      hoja.pdf = hoja.pdfOriginal;
      if (!fecha) continue;
      try {
        hoja.pdf = cambiarFecha(hoja.pdfOriginal, fecha, this.glifos);
      } catch (error) {
        if (!(error instanceof FechaNoCambiada)) throw error;
        this.avisos.push(`${hoja.clave}: ${error.message}`);
      }
    }
    return this.avisos;
  }

  /** Un único PDF con todas las hojas. */
  pack() {
    const destino = new mupdf.PDFDocument();
    for (const hoja of this.hojas) {
      const origen = new mupdf.PDFDocument(hoja.pdf);
      destino.graftPage(-1, origen, 0);
      origen.destroy();
    }
    try {
      return guardar(destino);
    } finally {
      destino.destroy();
    }
  }
}

/**
 * Separa y firma las hojas.
 * Con `imagenFirma` (PNG) se pega esa firma aunque el documento ya esté firmado; sin ella se usa
 * la firma digital del propio documento. `sello` es la imagen del sello de la empresa; sin ella
 * las hojas salen sin sello.
 */
export function procesar(datos, { fecha = null, imagenFirma = null, sello = null } = {}) {
  const doc = abrirPdf(datos);
  try {
    const { glifos, textos } = recorrerTexto(doc);
    const paginas = localizarHojas(doc, textos);
    const firma = imagenFirma ?? capturarFirma(doc);
    const imagenes = new ImagenesComprimidas({ firma, sello });
    const hojas = [];
    let trabajador = "";

    for (const hoja of config.HOJAS) {
      const numeroPagina = paginas[hoja.clave];
      const salida = new mupdf.PDFDocument();
      // Solo la página: sin anotaciones ni campos (la firma digital original no sería válida al separar).
      salida.graftPage(-1, doc, numeroPagina);
      salida.findPage(0).delete("Annots");
      const pagina = salida.loadPage(0);

      const lineas = lineasDeTexto(pagina);
      const ancla = buscarAncla(pagina, hoja.ladoAncla, lineas);
      if (hoja.clave === config.HOJA_NOMBRE) trabajador = nombreTrabajador(pagina, ancla, lineas);
      pegarImagen(salida, pagina, imagenes.firma, hoja.firma, config.CAJA_FIRMA, ancla);
      if (hoja.sello && sello) pegarImagen(salida, pagina, imagenes.sello, hoja.sello, config.CAJA_SELLO, ancla);

      hojas.push({ clave: hoja.clave, titulo: hoja.titulo, paginaOrigen: numeroPagina + 1, pdfOriginal: guardar(salida), pdf: null });
      pagina.destroy();
      salida.destroy();
    }

    const textoHojas = Object.values(paginas).map((n) => textoPagina(doc.loadPage(n))).join(" ");
    const resultado = new Resultado(
      nombreParaArchivo(trabajador) || "TRABAJADOR",
      hojas,
      glifos,
      dniDelTexto(textoHojas),
      puestoDelTexto(textoHojas),
      firma,
    );
    imagenes.destroy();
    resultado.ponerFecha(fecha);
    return resultado;
  } finally {
    doc.destroy();
  }
}

/**
 * Ensayo con un PDF cualquiera de lo que se hace al procesar (leer el texto, recoger las letras,
 * guardar con imágenes), para que el motor de PDF esté a punto antes del primer documento real.
 */
export function calentar(datos, imagen) {
  const doc = abrirPdf(datos);
  try {
    recorrerTexto(doc);
    textoPagina(doc.loadPage(0));
    const salida = new mupdf.PDFDocument();
    salida.graftPage(-1, doc, 0);
    const pagina = salida.loadPage(0);
    const imagenes = new ImagenesComprimidas({ imagen });
    pegarImagen(salida, pagina, imagenes.imagen, { x: 0, y: 0 }, config.CAJA_FIRMA, buscarAncla(pagina, "izquierda"));
    // Como al cambiar la fecha: borrar un trozo de texto (aquí, una esquina vacía)
    pagina.createAnnotation("Redact").setRect([0, 0, 1, 1]);
    pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    // Los colores de los documentos laborales (CalRGB de JasperReports) y gris: la primera vez que
    // aparecen, preparar su conversión es de lo que más tarda.
    const calRGB = salida.addObject(["CalRGB", {
      Gamma: [2.2, 2.2, 2.2],
      WhitePoint: [0.95043, 1, 1.09],
      Matrix: [0.41239, 0.21264, 0.01933, 0.35758, 0.71517, 0.11919, 0.18045, 0.07218, 0.9504],
    }]);
    const espacio = anadirRecurso(salida, pagina.getObject(), "ColorSpace", "CSCal", calRGB);
    anadirContenido(salida, pagina.getObject(), `q /${espacio} cs 0.5 0.5 0.5 sc 0.5 g 0.5 G 0 0 1 1 re f Q`);
    renderRecorte((dispositivo, m) => pagina.run(dispositivo, m), mupdf.Matrix.scale(2, 2), [0, 0, 200, 100]);
    const pdf = guardar(salida);
    imagenes.destroy();
    salida.destroy();
    const final = new mupdf.PDFDocument(pdf);
    recorrerTexto(final);
    final.destroy();
    return pdf;
  } finally {
    doc.destroy();
  }
}

/**
 * La firma y el sello, comprimidos una sola vez en un PDF aparte para copiarlos ya comprimidos a
 * cada hoja. Si se añadieran en cada hoja, al guardarla se volverían a comprimir las tres veces,
 * que es de lo que más tarda al cargar un documento.
 */
class ImagenesComprimidas {
  constructor(imagenes) {
    const temporal = new mupdf.PDFDocument();
    const datos = {};
    for (const [clave, bytes] of Object.entries(imagenes)) {
      if (!bytes) continue;
      const imagen = new mupdf.Image(bytes);
      datos[clave] = { numero: temporal.addImage(imagen).asIndirect(), ancho: imagen.getWidth(), alto: imagen.getHeight() };
      imagen.destroy();
    }
    const buffer = temporal.saveToBuffer("compress"); // sin "garbage": se conservan los números de objeto
    this.doc = new mupdf.PDFDocument(buffer.asUint8Array().slice());
    buffer.destroy();
    temporal.destroy();
    for (const [clave, { numero, ancho, alto }] of Object.entries(datos)) {
      this[clave] = { ref: this.doc.newIndirect(numero), ancho, alto };
    }
  }

  destroy() {
    this.doc.destroy();
  }
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

/** Campo de firma digital del documento (el último si hay varios), o null. */
export function campoFirma(doc) {
  let encontrado = null;
  for (let i = 0; i < doc.countPages(); i++) {
    const pagina = doc.loadPage(i);
    for (const widget of pagina.getWidgets()) {
      if (widget.getFieldType() === "signature") encontrado = { pagina, widget };
    }
  }
  return encontrado;
}

/** PNG de la parte visible de la firma digital, recortando el blanco sobrante. */
export function capturarFirma(doc) {
  const campo = campoFirma(doc);
  if (!campo) throw new FirmaNoEncontrada("No se ha encontrado la firma digital en el documento. ¿Seguro que está firmado?");
  const zoom = config.PPP_CAPTURA / 72;
  const matriz = mupdf.Matrix.scale(zoom, zoom);
  const pix = campo.widget.toPixmap(matriz, mupdf.ColorSpace.DeviceRGB, false);
  const caja = cajaConTinta(pix);
  const limites = [pix.getX(), pix.getY(), pix.getX() + pix.getWidth(), pix.getY() + pix.getHeight()];
  pix.destroy();
  if (!caja) throw new ErrorProcesado("La firma digital no tiene una parte visible que se pueda copiar.");

  const margen = config.MARGEN_CAPTURA_PT * zoom;
  const recorte = [
    Math.max(limites[0], Math.floor(caja[0] - margen)),
    Math.max(limites[1], Math.floor(caja[1] - margen)),
    Math.min(limites[2], Math.ceil(caja[2] + margen)),
    Math.min(limites[3], Math.ceil(caja[3] + margen)),
  ];
  return renderRecorte((dispositivo, m) => campo.widget.run(dispositivo, m), matriz, recorte);
}

const TOLERANCIA_FIRMA = 14; // puntos de margen al buscar la firma pegada en una hoja ya hecha

/**
 * Firma pegada en una hoja ya hecha (INFO, EPI o REN), con el nombre y el DNI que figuran en ella.
 * Se reconoce por su posición: la que ocupa el sitio donde va la firma, no los logos ni el sello.
 */
export function firmaDeHoja(doc) {
  for (let i = 0; i < doc.countPages(); i++) {
    const pagina = doc.loadPage(i);
    const texto = textoPagina(pagina);
    const hoja = config.HOJAS.find((h) => normalizar(texto).includes(h.busqueda));
    if (!hoja) continue;
    const ancla = buscarAncla(pagina, hoja.ladoAncla);
    if (!ancla) continue;

    const x = ancla[0] + hoja.firma.dx;
    const y = ancla[1] + hoja.firma.dy;
    const t = TOLERANCIA_FIRMA;
    const zona = [x - t, y - t, x + config.CAJA_FIRMA.ancho + t, y + config.CAJA_FIRMA.alto + t];
    let mejor = null;
    const estructura = pagina.toStructuredText("preserve-images");
    estructura.walk({
      onImageBlock(bbox, _transformacion, imagen) {
        const dentro = Math.max(0, Math.min(bbox[2], zona[2]) - Math.max(bbox[0], zona[0])) *
          Math.max(0, Math.min(bbox[3], zona[3]) - Math.max(bbox[1], zona[1]));
        const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
        const proporcion = area ? dentro / area : 0;
        if (proporcion > 0.6 && (!mejor || proporcion > mejor.proporcion)) mejor = { proporcion, png: imagenAPng(imagen) };
      },
    });
    estructura.destroy();
    if (mejor) return { imagen: mejor.png, nombre: nombreDeLaFirma(pagina, ancla), nif: identificadorDelTexto(texto) };
  }
  return null;
}

/** Quién firma la hoja: en EPI el nombre va a la derecha del "Fdo." y en INFO y REN, debajo. */
function nombreDeLaFirma(pagina, ancla) {
  const util = (texto) => texto && !NIF_SUELTO.test(texto);
  for (const linea of lineasDeTexto(pagina)) {
    const mismaAltura = linea.bbox[1] < ancla[3] && linea.bbox[3] > ancla[1];
    if (!mismaAltura) continue;
    const texto = linea.chars.filter((ch) => ch.rect[0] > ancla[2]).map((ch) => ch.c).join("").trim();
    if (util(texto)) return texto;
  }
  const debajo = nombreTrabajador(pagina, ancla);
  return util(debajo) ? debajo : "";
}

function imagenAPng(imagen) {
  let pix = imagen.toPixmap();
  const espacio = pix.getColorSpace();
  if (espacio && !espacio.isRGB() && !espacio.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
  try {
    return pix.asPNG().slice();
  } finally {
    pix.destroy();
  }
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
  const aspecto = campo.widget.getObject().get("AP").get("N");
  if (aspecto.isNull()) return ["", ""];
  const coincidencia = FIRMANTE.exec(textosAspecto(aspecto, new Set(), 0).join(" "));
  if (!coincidencia) return ["", ""];
  return [coincidencia[1].replace(/\s+/g, " ").trim(), coincidencia[2].toUpperCase()];
}

function textosAspecto(objeto, vistos, nivel) {
  if (nivel > 6) return [];
  if (objeto.isIndirect()) {
    const numeroObjeto = objeto.asIndirect();
    if (vistos.has(numeroObjeto)) return [];
    vistos.add(numeroObjeto);
  }
  // En MuPDF.js el contenido de un stream solo se lee desde la referencia; al resolverla queda su diccionario.
  const resuelto = objeto.resolve();
  if (resuelto.isDictionary()) {
    const tipo = resuelto.get("Type");
    if (tipo.isName() && NO_RECORRER.has(tipo.asName())) return [];
  }
  const textos = [];
  if (objeto.isStream()) {
    const contenido = new TextDecoder("latin1").decode(objeto.readStream().asUint8Array());
    for (const m of contenido.matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g)) textos.push(desescapar(m[1]));
  }
  if (resuelto.isDictionary() || resuelto.isArray()) {
    resuelto.forEach((valor) => textos.push(...textosAspecto(valor, vistos, nivel + 1)));
  }
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

/**
 * Rectángulo del "Fdo." del lado indicado (el más bajo si hay varios). Se busca en las líneas de
 * texto ya leídas, sin distinguir mayúsculas, igual que la búsqueda de MuPDF pero sin volver a leer la página.
 */
export function buscarAncla(pagina, lado, lineas = lineasDeTexto(pagina)) {
  const [x0, , x1] = pagina.getBounds();
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

function pegarImagen(doc, pagina, imagen, colocacion, caja, ancla) {
  const escala = Math.min(caja.ancho / imagen.ancho, caja.alto / imagen.alto);
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  const [bx0, by0, bx1, by1] = pagina.getBounds();

  let x = ancla ? ancla[0] + colocacion.dx : colocacion.x;
  let y = ancla ? ancla[1] + colocacion.dy : colocacion.y;
  // Nunca fuera de la página, aunque el ancla esté muy abajo.
  x = Math.min(Math.max(x, bx0), bx1 - ancho);
  y = Math.min(Math.max(y, by0), by1 - alto);

  const objetoPagina = pagina.getObject();
  const nombre = anadirRecurso(doc, objetoPagina, "XObject", "ImgFirmador", doc.graftObject(imagen.ref));
  const matriz = mupdf.Matrix.concat([ancho, 0, 0, -alto, x, y + alto], mupdf.Matrix.invert(pagina.getTransform()));
  anadirContenido(doc, objetoPagina, `q ${matriz.map(numero).join(" ")} cm /${nombre} Do Q`);
}

function nombreTrabajador(pagina, ancla, lineas = lineasDeTexto(pagina)) {
  if (ancla) {
    const [, , x1] = pagina.getBounds();
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
  const coincidencia = /D\.\s*\/\s*Dña\.\s*:?\s*([\s\S]+?)\s+persona trabajadora/.exec(textoPagina(pagina));
  return coincidencia ? coincidencia[1] : "";
}
