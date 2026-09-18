// Documentos especiales de plataformas: plantillas que se rellenan con los datos del trabajador.
//
// Para añadir uno nuevo basta con copiar su plantilla en plantillas/ y añadir aquí su ficha:
// el texto del botón, el archivo, la página que se rellena y dónde va cada dato.
// Las coordenadas son las de MuPDF (origen arriba a la izquierda) y la "y" es la línea base del texto.
// Cada texto puede llevar "fuente" (una de las 14 estándar de PDF; por defecto Helvetica) y
// "centrado": true, y entonces la "x" es el centro del texto en vez de su inicio.

import { fechaDeHoy, MESES } from "./fecha.js";
import { anadirContenido, anadirRecurso, aPdf, guardar, mupdf, numero } from "./pdfutil.js";

const TAMANO_MINIMO = 6; // si el texto no cabe, se encoge hasta aquí

const dosCifras = (n) => String(n).padStart(2, "0");

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
  {
    id: "real-madrid",
    boton: "REAL MADRID",
    plantilla: "plantillas/real-madrid.pdf",
    archivo: (datos) => `DOCU ESPECIAL REAL MADRID - ${datos.trabajador}.pdf`,
    pagina: 0,
    campos: [
      { valor: (d) => fechaDeHoy(d.fecha), x: 332, y: 169.9, tamano: 8, ancho: 180 },
      { valor: (d) => d.trabajador, x: 131.5, y: 349.8, tamano: 9, ancho: 196, centrado: true },
      { valor: (d) => d.dni, x: 283.5, y: 349.8, tamano: 9, ancho: 88, centrado: true },
      // La fecha de entrega va en dos líneas, como en la plantilla
      { valor: (d) => fechaDeHoy(d.fecha).replace(/ \d{4}$/, ""), x: 374, y: 342.3, tamano: 7, ancho: 78, centrado: true },
      { valor: (d) => String(d.fecha.getFullYear()), x: 374, y: 355.8, tamano: 7, ancho: 78, centrado: true },
      { imagen: (d) => d.firma, x: 417.1, y: 331.9, ancho: 69, alto: 30.2 },
    ],
  },
  {
    id: "atleti",
    boton: "ATLETI",
    plantilla: "plantillas/atleti.pdf",
    archivo: (datos) => `DOCU ESPECIAL ATLETI - ${datos.trabajador}.pdf`,
    pagina: 0,
    campos: [
      { valor: (d) => d.trabajador, x: 54.4, y: 722.5, tamano: 10.5, ancho: 222 },
      { valor: (d) => d.dni, x: 279.5, y: 711.1, tamano: 10.5, ancho: 90, fuente: "Helvetica-Bold" },
      {
        valor: (d) => `${dosCifras(d.fecha.getDate())}/${dosCifras(d.fecha.getMonth() + 1)}/${d.fecha.getFullYear()}`,
        x: 371.7, y: 710, tamano: 10, ancho: 62, fuente: "Times-Roman",
      },
      { imagen: (d) => d.firma, x: 436.6, y: 689.2, ancho: 117.5, alto: 52.1 },
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

    // Solo fuentes de las 14 estándar, que todo lector de PDF tiene
    const fuentes = new Map();
    const fuenteDe = (nombre = "Helvetica") => {
      if (!fuentes.has(nombre)) {
        const fuente = new mupdf.Font(nombre);
        const recurso = anadirRecurso(doc, objetoPagina, "Font", "FEspecial", doc.addSimpleFont(fuente, "Latin"));
        fuentes.set(nombre, { fuente, recurso });
      }
      return fuentes.get(nombre);
    };

    const operadores = [];
    for (const campo of especial.campos) {
      if (campo.imagen) {
        pegarImagen(doc, pagina, objetoPagina, campo.imagen(datos), campo, operadores);
        continue;
      }
      const texto = (campo.valor(datos) ?? "").trim();
      if (!texto) continue;
      const { fuente, recurso } = fuenteDe(campo.fuente);
      const tamano = tamanoQueCabe(fuente, texto, campo.tamano, campo.ancho);
      const inicio = campo.centrado ? campo.x - anchoDelTexto(fuente, texto, tamano) / 2 : campo.x;
      const [x, y] = aPdf(pagina, [inicio, campo.y]);
      operadores.push(`q BT 0 g /${recurso} ${numero(tamano)} Tf 1 0 0 1 ${numero(x)} ${numero(y)} Tm (${escapar(texto)}) Tj ET Q`);
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
