// Documentos especiales de plataformas: plantillas que se rellenan con los datos del trabajador.
//
// Para añadir uno nuevo basta con copiar su plantilla en plantillas/ y añadir aquí su ficha:
// el texto del botón, el archivo, la página que se rellena y dónde va cada dato.
// Las coordenadas son las de MuPDF (origen arriba a la izquierda) y la "y" es la línea base del texto.

import { MESES } from "./fecha.js";
import { anadirContenido, anadirRecurso, aPdf, guardar, mupdf, numero } from "./pdfutil.js";

const TAMANO_MINIMO = 6; // si el texto no cabe, se encoge hasta aquí

export const ESPECIALES = [
  {
    id: "iese-madrid",
    boton: "IESE MADRID",
    plantilla: "plantillas/iese-madrid.pdf",
    archivo: (datos) => `DOCU ESPECIAL IESE MADRID - ${datos.trabajador}.pdf`,
    pagina: -1, // la última
    campos: [
      { valor: (d) => String(d.fecha.getDate()), x: 344.7, y: 169.7, tamano: 9, ancho: 45 },
      { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 396.8, y: 169.7, tamano: 9, ancho: 85 },
      { valor: (d) => String(d.fecha.getFullYear()).slice(-2), x: 487.4, y: 169.7, tamano: 9, ancho: 20 },
      // El hueco del nombre acaba donde empieza "con D.N.I. nº" (x=256,6) y el del DNI, en x=393,4
      { valor: (d) => d.trabajador, x: 120.1, y: 240.3, tamano: 9, ancho: 134 },
      { valor: (d) => d.dni, x: 319.7, y: 240.3, tamano: 9, ancho: 70 },
      { valor: (d) => d.trabajador, x: 73.6, y: 643.6, tamano: 9, ancho: 190 },
      { imagen: (d) => d.firma, x: 269.6, y: 634.2, ancho: 102, alto: 40.3 },
    ],
  },
];

/** PDF de un documento especial relleno con los datos del trabajador. */
export function generar(especial, plantilla, datos) {
  const doc = new mupdf.PDFDocument(plantilla);
  try {
    const indice = especial.pagina < 0 ? doc.countPages() + especial.pagina : especial.pagina;
    const pagina = doc.loadPage(indice);
    const objetoPagina = pagina.getObject();
    const fuente = new mupdf.Font("Helvetica"); // una de las 14 fuentes que todo lector de PDF tiene
    const nombreFuente = anadirRecurso(doc, objetoPagina, "Font", "FEspecial", doc.addSimpleFont(fuente, "Latin"));

    const operadores = [];
    for (const campo of especial.campos) {
      if (campo.imagen) {
        pegarImagen(doc, pagina, objetoPagina, campo.imagen(datos), campo, operadores);
        continue;
      }
      const texto = (campo.valor(datos) ?? "").trim();
      if (!texto) continue;
      const tamano = tamanoQueCabe(fuente, texto, campo.tamano, campo.ancho);
      const [x, y] = aPdf(pagina, [campo.x, campo.y]);
      operadores.push(`q BT 0 g /${nombreFuente} ${numero(tamano)} Tf 1 0 0 1 ${numero(x)} ${numero(y)} Tm (${escapar(texto)}) Tj ET Q`);
    }
    anadirContenido(doc, objetoPagina, operadores.join("\n"));
    return guardar(doc);
  } finally {
    doc.destroy();
  }
}

function pegarImagen(doc, pagina, objetoPagina, bytes, campo, operadores) {
  if (!bytes) return;
  const imagen = new mupdf.Image(bytes);
  const escala = Math.min(campo.ancho / imagen.getWidth(), campo.alto / imagen.getHeight());
  const ancho = imagen.getWidth() * escala;
  const alto = imagen.getHeight() * escala;
  const nombre = anadirRecurso(doc, objetoPagina, "XObject", "ImgEspecial", doc.addImage(imagen));
  const matriz = mupdf.Matrix.concat([ancho, 0, 0, -alto, campo.x, campo.y + alto], mupdf.Matrix.invert(pagina.getTransform()));
  operadores.push(`q ${matriz.map(numero).join(" ")} cm /${nombre} Do Q`);
  imagen.destroy();
}

function anchoDelTexto(fuente, texto, tamano) {
  let total = 0;
  for (const caracter of texto) total += fuente.advanceGlyph(fuente.encodeCharacter(caracter.codePointAt(0)));
  return total * tamano;
}

/** Encoge la letra lo justo para que el texto quepa en su hueco (nombres muy largos). */
function tamanoQueCabe(fuente, texto, tamano, ancho) {
  let actual = tamano;
  while (actual > TAMANO_MINIMO && anchoDelTexto(fuente, texto, actual) > ancho) actual -= 0.25;
  return actual;
}

/** Texto para un PDF con codificación WinAnsi: se escapa todo lo que no sea ASCII imprimible. */
function escapar(texto) {
  let salida = "";
  for (const caracter of texto) {
    const codigo = winAnsi(caracter);
    if (codigo === null) continue;
    if (codigo === 40 || codigo === 41 || codigo === 92) salida += `\\${String.fromCharCode(codigo)}`;
    else if (codigo < 32 || codigo > 126) salida += `\\${codigo.toString(8).padStart(3, "0")}`;
    else salida += String.fromCharCode(codigo);
  }
  return salida;
}

// Caracteres de WinAnsi que no coinciden con Unicode (los demás sí, hasta el 255).
const WINANSI_ESPECIALES = { "€": 128, "‚": 130, "ƒ": 131, "„": 132, "…": 133, "†": 134, "‡": 135, "ˆ": 136, "‰": 137, "Š": 138, "‹": 139, "Œ": 140, "Ž": 142, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "˜": 152, "™": 153, "š": 154, "›": 155, "œ": 156, "ž": 158, "Ÿ": 159 };

function winAnsi(caracter) {
  const codigo = caracter.codePointAt(0);
  if (codigo <= 255) return codigo;
  return WINANSI_ESPECIALES[caracter] ?? null;
}
