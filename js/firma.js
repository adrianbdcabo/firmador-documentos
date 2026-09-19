// © 2026 Adrián Barroso de Cabo.
// La firma que se pega en las hojas: sacada de un PDF firmado o de una captura de pantalla.

import { aplanarSobreBlanco, cajaConTinta, decodificar, png, recortar } from "./imagenes.js";
import { abrirCacheado, campoFirma, capturarFirma, firmaDeHoja, firmante, localizarHojas } from "./pdf.js";
import { ErrorProcesado, FirmaNoEncontrada, abrirPdf } from "./pdfbase.js";

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
export async function desdePdf(datos, origen) {
  const doc = await abrirPdf(datos);
  if (campoFirma(doc)) {
    const [nombre, nif] = firmante(doc);
    return new Firma(await capturarFirma(doc), origen, nombre, nif);
  }
  const deHoja = await firmaDeHoja(doc);
  if (deHoja) return new Firma(deHoja.imagen, origen, deHoja.nombre, deHoja.nif);
  throw new FirmaNoEncontrada(
    "Ese PDF no tiene firma digital ni es una hoja ya firmada (INFO, EPI o REN) de la que copiar la firma.",
  );
}

const PAGINAS_HOJA_SUELTA = 3; // el documento global tiene muchas más

/** Si el PDF es una hoja suelta ya firmada (y no el documento global), su firma; si no, null. */
export async function deHojaSuelta(datos, origen) {
  const doc = await abrirCacheado(datos); // si luego se procesa como documento laboral, ya está abierto
  if (doc.getPageCount() > PAGINAS_HOJA_SUELTA) return null;
  try {
    localizarHojas(doc); // si están las 3, es un documento laboral, no una hoja suelta
    return null;
  } catch {
    const deHoja = await firmaDeHoja(doc);
    return deHoja ? new Firma(deHoja.imagen, origen, deHoja.nombre, deHoja.nif) : null;
  }
}

/** Firma a partir de una captura: se aplana sobre blanco y se recorta el margen vacío. */
export async function desdeImagen(datos, origen) {
  let imagen;
  try {
    imagen = await decodificar(datos instanceof Uint8Array ? datos : new Uint8Array(datos));
    if (!imagen.ancho || !imagen.alto) throw new Error("vacía");
  } catch {
    throw new ErrorProcesado("No se puede leer la imagen. Usa un PDF firmado o una captura en PNG o JPG.");
  }
  const sobreBlanco = aplanarSobreBlanco(imagen);
  const caja = cajaConTinta(sobreBlanco);
  if (!caja) throw new ErrorProcesado("La imagen está en blanco: no se ve ninguna firma.");
  const m = MARGEN_CAPTURA_PX;
  const recorte = [Math.max(0, caja[0] - m), Math.max(0, caja[1] - m), Math.min(imagen.ancho, caja[2] + m), Math.min(imagen.alto, caja[3] + m)];
  return new Firma(await png(recortar(sobreBlanco, recorte)), origen);
}

function identificador(texto) {
  return texto.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
