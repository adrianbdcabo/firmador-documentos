// © 2026 Adrián Barroso de Cabo.
// Documento especial NO USO MAQUINARIA: la carta en la que TEMPS confirma que el registro de equipos
// de trabajo "no aplica". Solo lleva la fecha de hoy en su primera línea ("En Madrid a 29 de
// septiembre de 2026,"). No se rellena con huecos como los demás documentos especiales, porque la
// plantilla es un Word en el que la fecha es texto normal de la frase.
//
// La plantilla trae la fecha vieja escrita y, encima, una pila de parches (un XObject "FFT0") de
// cambios de fecha anteriores. Aquí se borran las letras de la fecha vieja, se quita el parche y se
// escribe la nueva con la misma fuente (Aptos) del documento. Al ser una fuente recortada, a veces
// le faltan cifras (el 5, el 7 o el 9): esas salen de la Helvetica de repuesto, como en MACADAMIA.

import { MESES, leerHoja, quitarGlifos, recorrerTexto } from "./fecha.js";
import { anchoChar, escribir } from "./parrafo.js";
import { abrirPdf, cambiarContenido, guardar } from "./pdfbase.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

export class MaquinariaNoRellenado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "MaquinariaNoRellenado";
  }
}

/** "29 de septiembre de 2026," con el mes en minúscula, como está escrito el documento. */
export function fechaDeLaCarta(fecha) {
  return `${fecha.getDate()} de ${MESES[fecha.getMonth()].toLowerCase()} de ${fecha.getFullYear()},`;
}

export async function generarMaquinaria(plantilla, datos) {
  const doc = await abrirPdf(plantilla);
  const pagina = doc.getPage(0);
  const { glifos } = recorrerTexto(doc);
  const { lectura, linea } = leerHoja(doc, pagina);
  if (!linea) throw new MaquinariaNoRellenado("no se encuentra la fecha del documento.");

  const viejas = linea.chars.slice(linea.inicio);
  const borrar = new Set(viejas.map((ch) => ch.glifo).filter(Boolean));
  if ([...borrar].some((glifo) => !glifo.editable)) throw new MaquinariaNoRellenado("la fecha no se puede modificar.");
  const quitado = quitarGlifos(lectura, borrar);
  const sinParche = new TextEncoder().encode(new TextDecoder("latin1").decode(quitado).replace("/FFT0 Do", ""));
  cambiarContenido(doc, pagina, sinParche);

  const modelo = viejas.find((ch) => ch.glifo);
  const [x0, y] = modelo.glifo.origen;
  const medida = {
    mapas: glifos,
    modo: "glifos",
    respaldo: { normal: await doc.embedFont(StandardFonts.Helvetica), negrita: await doc.embedFont(StandardFonts.HelveticaBold) },
  };
  let x = x0;
  const palabras = [];
  for (const texto of fechaDeLaCarta(datos.fecha ?? new Date()).split(" ")) {
    const chars = [...texto].map((c) => ({ ...modelo, c, glifo: null, negrita: false }));
    palabras.push({ chars, x, y });
    x += chars.reduce((suma, ch) => suma + anchoChar(ch, medida), 0)
      + anchoChar({ ...modelo, c: " ", negrita: false }, medida);
  }
  escribir(doc, pagina, [palabras], medida);
  return guardar(doc);
}
