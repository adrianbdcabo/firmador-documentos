// © 2026 Adrián Barroso de Cabo.
// Documentos especiales de plataformas: plantillas que se rellenan con los datos del trabajador.
//
// Para añadir uno nuevo basta con copiar su plantilla en plantillas/ y añadir aquí su ficha:
// el texto del botón, el archivo, la página que se rellena y dónde va cada dato. Si una plataforma
// pide varios documentos, su ficha lleva "documentos": una lista con plantilla, archivo, página y
// campos de cada uno, y el botón los descarga todos.
// Las coordenadas son en puntos con el origen arriba a la izquierda y la "y" es la línea base del texto.
// Cada texto puede llevar "fuente" (una de las 14 estándar de PDF; por defecto Helvetica) y
// "centrado": true, y entonces la "x" es el centro del texto en vez de su inicio. Con "lineas": N
// el texto se parte por palabras en hasta N líneas si no cabe en una ("interlineado", distancia entre ellas).

import { fechaDeHoy, MESES } from "./fecha.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { PDFDocument, aPdf, anadirContenido, anadirRecurso, guardar, incrustarImagen, invertir, multiplicar, numero, transformacion } from "./pdfbase.js";

const TAMANO_MINIMO = 6; // si el texto no cabe, se encoge hasta aquí

const dosCifras = (n) => String(n).padStart(2, "0");
const fechaCorta = (fecha) => `${dosCifras(fecha.getDate())}/${dosCifras(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;

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
    // Mismo formulario que IESE MADRID (Universidad de Navarra), con los huecos en otro sitio
    id: "cun-madrid",
    boton: "CUN MADRID",
    plantilla: "plantillas/cun-madrid.pdf",
    archivo: (datos) => `DOCU ESPECIAL CUN MADRID - ${datos.trabajador}.pdf`,
    pagina: -1,
    campos: [
      // Huecos entre "a" (x=374,3) y "de" (389,8), hasta el "de" (480,4) y tras "20" (501,5)
      { valor: (d) => String(d.fecha.getDate()), x: 376.8, y: 207.2, tamano: 9, ancho: 12.5 },
      { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 412.1, y: 207.2, tamano: 9, ancho: 66 },
      { valor: (d) => String(d.fecha.getFullYear()).slice(-2), x: 502.1, y: 207.2, tamano: 9, ancho: 12 },
      // El nombre acaba donde empieza "con D.N.I. nº" (x=251,5)
      { valor: (d) => d.trabajador, x: 103.7, y: 276.7, tamano: 9, ancho: 146 },
      { valor: (d) => d.dni, x: 317.2, y: 276.7, tamano: 9, ancho: 70 },
      { valor: (d) => d.trabajador, x: 71.7, y: 659.6, tamano: 9, ancho: 195 },
      { imagen: (d) => d.firma, x: 269.3, y: 649.9, ancho: 86, alto: 33.5 },
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
        valor: (d) => fechaCorta(d.fecha),
        x: 371.7, y: 710, tamano: 10, ancho: 62, fuente: "Times-Roman",
      },
      { imagen: (d) => d.firma, x: 436.6, y: 689.2, ancho: 117.5, alto: 52.1 },
    ],
  },
  {
    id: "thales",
    boton: "THALES",
    plantilla: "plantillas/thales.pdf",
    archivo: (datos) => `DOCU ESPECIAL THALES - ${datos.trabajador}.pdf`,
    pagina: 0, // la hoja es apaisada
    campos: [
      { valor: (d) => fechaCorta(d.fecha), x: 718.9, y: 150.3, tamano: 9, ancho: 92 },
      // Primera fila de la tabla: nombre, DNI/NIE, puesto (hasta tres líneas, como la columna de EPIS) y firma
      { valor: (d) => d.trabajador, x: 27.3, y: 315.7, tamano: 9, ancho: 144, lineas: 3, interlineado: 10.8 },
      { valor: (d) => d.dni, x: 176.7, y: 315.7, tamano: 9, ancho: 94 },
      { valor: (d) => d.puesto, x: 274.7, y: 315.7, tamano: 9, ancho: 95, lineas: 3, interlineado: 10.8 },
      { imagen: (d) => d.firma, x: 680.2, y: 306.7, ancho: 83, alto: 34.3 },
    ],
  },
  {
    // Dos documentos: el recibí de la normativa de seguridad y la información de riesgos
    id: "sandoz",
    boton: "SANDOZ",
    documentos: [
      {
        plantilla: "plantillas/sandoz-recibi.pdf",
        archivo: (datos) => `RECIBI SANDOZ - ${datos.trabajador}.pdf`,
        pagina: -1,
        campos: [
          { imagen: (d) => d.firma, x: 131.2, y: 81, ancho: 57, alto: 23.8 },
          { valor: (d) => d.trabajador, x: 193.8, y: 120.6, tamano: 9, ancho: 340 },
          { valor: (d) => fechaCorta(d.fecha), x: 126.1, y: 182.9, tamano: 9, ancho: 150 },
        ],
      },
      {
        plantilla: "plantillas/sandoz-info.pdf",
        archivo: (datos) => `INFO SANDOZ - ${datos.trabajador}.pdf`,
        pagina: 0,
        campos: [
          { valor: (d) => fechaCorta(d.fecha), x: 144.4, y: 649.3, tamano: 9, ancho: 100 },
          { imagen: (d) => d.firma, x: 254.8, y: 654.4, ancho: 57, alto: 23.8 },
          { imagen: (d) => d.sello, x: 370.7, y: 657.1, ancho: 87, alto: 64.5 }, // siempre lleva el sello
        ],
      },
    ],
  },
  {
    // Dos documentos: ANEXO 12 (certificado de formación e información) y ANEXO 24 (renuncia al reconocimiento médico)
    id: "cepsa",
    boton: "CEPSA",
    documentos: [
      {
        plantilla: "plantillas/cepsa-anexo-12.pdf",
        archivo: (datos) => `ANEXO 12 CEPSA - ${datos.trabajador}.pdf`,
        pagina: 0,
        campos: [
          { valor: (d) => fechaDeHoy(d.fecha).toUpperCase(), x: 146.8, y: 152.7, tamano: 10, ancho: 250 },
          // Nombre y DNI en cursiva, como las etiquetas de la plantilla
          { valor: (d) => d.trabajador, x: 198.8, y: 244.6, tamano: 10, ancho: 320, fuente: "Helvetica-Oblique" },
          { valor: (d) => d.dni, x: 121.8, y: 281.4, tamano: 10, ancho: 150, fuente: "Helvetica-Oblique" },
          { imagen: (d) => d.firma, x: 64.3, y: 625.1, ancho: 81, alto: 34.8 },
          { imagen: (d) => d.sello, x: 67.7, y: 732.3, ancho: 71, alto: 52.6 }, // siempre lleva el sello
        ],
      },
      {
        plantilla: "plantillas/cepsa-anexo-24.pdf",
        archivo: (datos) => `ANEXO 24 CEPSA - ${datos.trabajador}.pdf`,
        pagina: 0,
        campos: [
          { valor: (d) => d.trabajador, x: 196.2, y: 188.3, tamano: 9, ancho: 305 }, // hasta el "con" (x=511)
          { valor: (d) => d.dni, x: 109.9, y: 213.2, tamano: 9, ancho: 64 }, // hasta "en la empresa" (x=177)
          { valor: (d) => d.puesto, x: 106.7, y: 249, tamano: 9, ancho: 420 },
          // "En MADRID , a __ de ______ de ____"
          { valor: (d) => String(d.fecha.getDate()), x: 155, y: 438.9, tamano: 9, ancho: 19 },
          { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 197.8, y: 438.9, tamano: 9, ancho: 67 },
          { valor: (d) => String(d.fecha.getFullYear()), x: 290, y: 438.9, tamano: 9, ancho: 40 },
          { imagen: (d) => d.firma, x: 70.4, y: 545.7, ancho: 81, alto: 34.8 },
        ],
      },
    ],
  },
];

/** Los documentos que descarga el botón de una plataforma (casi siempre, uno). */
export function documentosDe(especial) {
  return especial.documentos ?? [especial];
}

/** PDF de un documento especial relleno con los datos del trabajador. */
export async function generar(especial, plantilla, datos) {
  const doc = await PDFDocument.load(plantilla, { updateMetadata: false });
  const indice = especial.pagina < 0 ? doc.getPageCount() + especial.pagina : especial.pagina;
  const pagina = doc.getPage(indice);

  // Solo fuentes de las 14 estándar, que todo lector de PDF tiene
  const fuentes = new Map();
  const fuenteDe = async (nombre = "Helvetica") => {
    if (!fuentes.has(nombre)) {
      const fuente = await doc.embedFont(FUENTES[nombre] ?? StandardFonts.Helvetica);
      const recurso = anadirRecurso(doc, pagina, "Font", "FEspecial", fuente.ref);
      fuentes.set(nombre, { fuente, recurso });
    }
    return fuentes.get(nombre);
  };

  const operadores = [];
  for (const campo of especial.campos) {
    if (campo.imagen) {
      await pegarImagen(doc, pagina, campo.imagen(datos), campo, operadores);
      continue;
    }
    const texto = (campo.valor(datos) ?? "").trim();
    if (!texto) continue;
    const { fuente, recurso } = await fuenteDe(campo.fuente);
    const { tamano, lineas } = repartir(fuente, texto, campo);
    lineas.forEach((linea, i) => {
      // Si ni con la letra más pequeña cabe, se estrecha el texto hasta que quepa
      const anchoTexto = anchoDelTexto(fuente, linea, tamano);
      const estrechar = Math.min(1, campo.ancho / anchoTexto);
      const inicio = campo.centrado ? campo.x - (anchoTexto * estrechar) / 2 : campo.x;
      const [x, y] = aPdf(doc, pagina, [inicio, campo.y + i * (campo.interlineado ?? tamano * 1.2)]);
      const tz = estrechar < 1 ? `${numero(estrechar * 100)} Tz ` : "";
      operadores.push(`q BT 0 g /${recurso} ${numero(tamano)} Tf ${tz}1 0 0 1 ${numero(x)} ${numero(y)} Tm (${escapar(linea)}) Tj ET Q`);
    });
  }
  anadirContenido(doc, pagina, operadores.join("\n"));
  return guardar(doc);
}

const FUENTES = {
  Helvetica: StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
  "Helvetica-Oblique": StandardFonts.HelveticaOblique,
  "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
  "Times-Roman": StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  "Times-Italic": StandardFonts.TimesRomanItalic,
  "Times-BoldItalic": StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  "Courier-Bold": StandardFonts.CourierBold,
};

async function pegarImagen(doc, pagina, bytes, campo, operadores) {
  if (!bytes) return;
  const imagen = await incrustarImagen(doc, bytes);
  const escala = Math.min(campo.ancho / imagen.ancho, campo.alto / imagen.alto);
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  const nombre = anadirRecurso(doc, pagina, "XObject", "ImgEspecial", imagen.ref);
  const matriz = multiplicar([ancho, 0, 0, -alto, campo.x, campo.y + alto], invertir(transformacion(doc, pagina)));
  operadores.push(`q ${matriz.map(numero).join(" ")} cm /${nombre} Do Q`);
}

/**
 * Ancho del texto con esa fuente y tamaño, letra a letra: el PDF se dibuja sin ajustes entre pares
 * de letras (kerning), así que no se tienen en cuenta. Solo cuentan las letras que se pueden escribir.
 */
function anchoDelTexto(fuente, texto, tamano) {
  let total = 0;
  for (const caracter of texto) if (winAnsi(caracter) !== null) total += fuente.widthOfTextAtSize(caracter, tamano);
  return total;
}

/**
 * Reparte el texto en las líneas que admite el campo ("lineas", 1 por defecto) y encoge la
 * letra lo justo para que quepa. Si ni así cabe, lo que sobra va en la última línea.
 */
function repartir(fuente, texto, campo) {
  const maximo = campo.lineas ?? 1;
  if (maximo === 1) return { tamano: tamanoQueCabe(fuente, texto, campo.tamano, campo.ancho), lineas: [texto] };
  for (let tamano = campo.tamano; tamano >= TAMANO_MINIMO; tamano -= 0.25) {
    const lineas = partir(fuente, texto, tamano, campo.ancho);
    if (lineas.length <= maximo && lineas.every((l) => anchoDelTexto(fuente, l, tamano) <= campo.ancho)) return { tamano, lineas };
  }
  const lineas = partir(fuente, texto, TAMANO_MINIMO, campo.ancho);
  return { tamano: TAMANO_MINIMO, lineas: [...lineas.slice(0, maximo - 1), lineas.slice(maximo - 1).join(" ")] };
}

/** Parte el texto por palabras en líneas que no pasen del ancho. */
function partir(fuente, texto, tamano, ancho) {
  const lineas = [];
  for (const palabra of texto.split(/\s+/)) {
    const ultima = lineas.at(-1);
    if (ultima !== undefined && anchoDelTexto(fuente, `${ultima} ${palabra}`, tamano) <= ancho) lineas[lineas.length - 1] = `${ultima} ${palabra}`;
    else lineas.push(palabra);
  }
  return lineas;
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
