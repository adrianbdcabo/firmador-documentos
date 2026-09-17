// La firma que se pega en las hojas: sacada de un PDF firmado o de una captura de pantalla.

import { campoFirma, capturarFirma, firmaDeHoja, firmante, localizarHojas } from "./pdf.js";
import { ErrorProcesado, FirmaNoEncontrada, abrirPdf, cajaConTinta, mupdf, renderRecorte } from "./pdfutil.js";

const MARGEN_CAPTURA_PX = 3;

export class Firma {
  constructor(imagen, origen, nombre = "", nif = "") {
    this.imagen = imagen; // PNG ya recortado, listo para pegar
    this.origen = origen; // nombre del archivo o "captura pegada"
    this.nombre = nombre; // firmante y NIF: solo se conocen si viene de un PDF firmado
    this.nif = nif;
    this.usada = false; // ya se ha aplicado a un documento laboral
  }

  /** false solo si se sabe con seguridad que la firma es de otra persona. */
  esDe(dni) {
    if (!this.nif || !dni) return true;
    return identificador(this.nif) === identificador(dni);
  }
}

/** Firma de un PDF: la digital si la tiene y, si no, la que lleva pegada una hoja ya hecha. */
export function desdePdf(datos, origen) {
  const doc = abrirPdf(datos);
  try {
    if (campoFirma(doc)) {
      const [nombre, nif] = firmante(doc);
      return new Firma(capturarFirma(doc), origen, nombre, nif);
    }
    const deHoja = firmaDeHoja(doc);
    if (deHoja) return new Firma(deHoja.imagen, origen, deHoja.nombre, deHoja.nif);
    throw new FirmaNoEncontrada(
      "Ese PDF no tiene firma digital ni es una hoja ya firmada (INFO, EPI o REN) de la que copiar la firma.",
    );
  } finally {
    doc.destroy();
  }
}

const PAGINAS_HOJA_SUELTA = 3; // el documento global tiene muchas más

/** Si el PDF es una hoja suelta ya firmada (y no el documento global), su firma; si no, null. */
export function deHojaSuelta(datos, origen) {
  const doc = abrirPdf(datos);
  try {
    if (doc.countPages() > PAGINAS_HOJA_SUELTA) return null;
    try {
      localizarHojas(doc); // si están las 3, es un documento laboral, no una hoja suelta
      return null;
    } catch {
      const deHoja = firmaDeHoja(doc);
      return deHoja ? new Firma(deHoja.imagen, origen, deHoja.nombre, deHoja.nif) : null;
    }
  } finally {
    doc.destroy();
  }
}

/** Firma a partir de una captura: se aplana sobre blanco y se recorta el margen vacío. */
export function desdeImagen(datos, origen) {
  const pagina = paginaConImagen(datos, "No se puede leer la imagen. Usa un PDF firmado o una captura en PNG o JPG.");
  try {
    const pix = pagina.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    const caja = cajaConTinta(pix);
    const [, , ancho, alto] = pagina.getBounds();
    pix.destroy();
    if (!caja) throw new ErrorProcesado("La imagen está en blanco: no se ve ninguna firma.");
    const m = MARGEN_CAPTURA_PX;
    const recorte = [Math.max(0, caja[0] - m), Math.max(0, caja[1] - m), Math.min(ancho, caja[2] + m), Math.min(alto, caja[3] + m)];
    return new Firma(renderRecorte((dispositivo, matriz) => pagina.run(dispositivo, matriz), mupdf.Matrix.identity, recorte), origen);
  } finally {
    pagina.destroy();
  }
}

function paginaConImagen(datos, mensajeError) {
  let imagen;
  try {
    imagen = new mupdf.Image(datos instanceof Uint8Array ? datos : new Uint8Array(datos));
    if (!imagen.getWidth() || !imagen.getHeight()) throw new Error("vacía");
  } catch {
    throw new ErrorProcesado(mensajeError);
  }
  const ancho = imagen.getWidth();
  const alto = imagen.getHeight();
  const doc = new mupdf.PDFDocument();
  const recursos = doc.newDictionary();
  const xobjects = doc.newDictionary();
  xobjects.put("Im0", doc.addImage(imagen));
  recursos.put("XObject", xobjects);
  doc.insertPage(-1, doc.addPage([0, 0, ancho, alto], 0, recursos, `q ${ancho} 0 0 ${alto} 0 0 cm /Im0 Do Q`));
  imagen.destroy();
  return doc.loadPage(0); // la página mantiene vivo el documento
}

function identificador(texto) {
  return texto.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
