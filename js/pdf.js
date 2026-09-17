// Lógica principal: localiza las hojas, captura la firma digital y pega firma y sello.

import * as config from "./config.js";
import { FechaNoCambiada, cambiarFecha, glifosDelDocumento } from "./fecha.js";
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
  constructor(trabajador, hojas, glifos, dni) {
    this.trabajador = trabajador;
    this.hojas = hojas; // [{ clave, titulo, paginaOrigen, pdfOriginal, pdf }]
    this.glifos = glifos;
    this.dni = dni;
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
 * la firma digital del propio documento. `sello` es la imagen del sello de la empresa.
 */
export function procesar(datos, { fecha = null, imagenFirma = null, sello = null } = {}) {
  if (!sello) throw new ErrorProcesado("Falta el sello de la empresa: cárgalo con «Cargar sello».");
  const doc = abrirPdf(datos);
  try {
    const paginas = localizarHojas(doc);
    const firma = imagenFirma ?? capturarFirma(doc);
    const hojas = [];
    let trabajador = "";

    for (const hoja of config.HOJAS) {
      const numeroPagina = paginas[hoja.clave];
      const salida = new mupdf.PDFDocument();
      // Solo la página: sin anotaciones ni campos (la firma digital original no sería válida al separar).
      salida.graftPage(-1, doc, numeroPagina);
      salida.findPage(0).delete("Annots");
      const pagina = salida.loadPage(0);

      const ancla = buscarAncla(pagina, hoja.ladoAncla);
      if (hoja.clave === config.HOJA_NOMBRE) trabajador = nombreTrabajador(pagina, ancla);
      pegarImagen(salida, pagina, firma, hoja.firma, config.CAJA_FIRMA, ancla);
      if (hoja.sello) pegarImagen(salida, pagina, sello, hoja.sello, config.CAJA_SELLO, ancla);

      hojas.push({ clave: hoja.clave, titulo: hoja.titulo, paginaOrigen: numeroPagina + 1, pdfOriginal: guardar(salida), pdf: null });
      pagina.destroy();
      salida.destroy();
    }

    const dni = dniDelTexto(Object.values(paginas).map((n) => textoPagina(doc.loadPage(n))).join(" "));
    const resultado = new Resultado(nombreParaArchivo(trabajador) || "TRABAJADOR", hojas, glifosDelDocumento(doc), dni);
    resultado.ponerFecha(fecha);
    return resultado;
  } finally {
    doc.destroy();
  }
}

export function normalizar(texto) {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").toUpperCase().trim();
}

/** Índice (base 0) de la página de cada hoja, buscándola por su título en todo el documento. */
export function localizarHojas(doc) {
  const textos = [];
  for (let i = 0; i < doc.countPages(); i++) textos.push(normalizar(textoPagina(doc.loadPage(i))));
  if (!textos.some(Boolean)) {
    throw new ErrorProcesado("El PDF no contiene texto (¿es un documento escaneado?), así que no se pueden localizar las hojas.");
  }
  const encontradas = {};
  const faltan = [];
  for (const hoja of config.HOJAS) {
    // Si el título aparece en varias páginas, gana la que lo tiene más arriba (su encabezado).
    let mejor = null;
    textos.forEach((texto, i) => {
      const posicion = texto.indexOf(hoja.busqueda);
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

export function dniDelTexto(texto) {
  const coincidencia = DNI.exec(texto.replace(/\s+/g, " "));
  return coincidencia ? coincidencia[1].toUpperCase() : "";
}

export function nombreParaArchivo(texto) {
  return texto.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
}

function buscarAncla(pagina, lado) {
  const [x0, , x1] = pagina.getBounds();
  const mitad = (x0 + x1) / 2;
  return pagina
    .search(config.TEXTO_ANCLA)
    .map((quads) => rectDeQuad(quads[0]))
    .filter((r) => (lado === "derecha" ? r[0] >= mitad : r[0] < mitad))
    .reduce((mejor, r) => (!mejor || r[1] > mejor[1] ? r : mejor), null);
}

function pegarImagen(doc, pagina, bytes, colocacion, caja, ancla) {
  const imagen = new mupdf.Image(bytes);
  const escala = Math.min(caja.ancho / imagen.getWidth(), caja.alto / imagen.getHeight());
  const ancho = imagen.getWidth() * escala;
  const alto = imagen.getHeight() * escala;
  const [bx0, by0, bx1, by1] = pagina.getBounds();

  let x = ancla ? ancla[0] + colocacion.dx : colocacion.x;
  let y = ancla ? ancla[1] + colocacion.dy : colocacion.y;
  // Nunca fuera de la página, aunque el ancla esté muy abajo.
  x = Math.min(Math.max(x, bx0), bx1 - ancho);
  y = Math.min(Math.max(y, by0), by1 - alto);

  const objetoPagina = pagina.getObject();
  const nombre = anadirRecurso(doc, objetoPagina, "XObject", "ImgFirmador", doc.addImage(imagen));
  const matriz = mupdf.Matrix.concat([ancho, 0, 0, -alto, x, y + alto], mupdf.Matrix.invert(pagina.getTransform()));
  anadirContenido(doc, objetoPagina, `q ${matriz.map(numero).join(" ")} cm /${nombre} Do Q`);
  imagen.destroy();
}

function nombreTrabajador(pagina, ancla) {
  if (ancla) {
    const [, , x1] = pagina.getBounds();
    const zona = [ancla[0] - 2, ancla[3], x1 - 20, ancla[3] + 30];
    for (const linea of lineasDeTexto(pagina)) {
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
