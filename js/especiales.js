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
// En una imagen, "centrado": true la coloca en el medio del hueco (x, y, ancho, alto) en vez de
// pegada a su esquina de arriba a la izquierda: es lo que hace que una firma quede dentro de la
// casilla de una tabla sin taparle las rayas.
//
// LOS DATOS QUE HAY PARA RELLENAR
//   d.trabajador  nombre completo, en orden normal ("CINTHIA OSAFAMEN")
//   d.apellidos   solo los apellidos, y d.nombre solo el nombre de pila: algunos impresos los
//                 piden en columnas separadas
//   d.dni         DNI o NIE del trabajador
//   d.puesto      su categoría o puesto, que cambia de un trabajador a otro
//   d.fecha       la fecha de hoy
//   d.firma       la captura de su firma digital, y d.sello el sello de la empresa
//
// TODO SE ESCRIBE EN NEGRO Y CON LA MISMA LETRA
// Aunque el impreso rellenado a mano tuviera la fecha en rojo o cada dato de un tamaño, aquí se
// escribe todo del mismo tamaño y en negro: queda más limpio y más uniforme.

import { fechaDeHoy, MESES } from "./fecha.js";
import { StandardFonts } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { PDFDocument, aPdf, anadirContenido, anadirRecurso, guardar, incrustarImagen, invertir, multiplicar, numero, transformacion } from "./pdfbase.js";

const TAMANO_MINIMO = 6; // si el texto no cabe, se encoge hasta aquí

const dosCifras = (n) => String(n).padStart(2, "0");
const fechaCorta = (fecha) => `${dosCifras(fecha.getDate())}/${dosCifras(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;

// Datos nuestros que se repiten en varios impresos.
const EMPRESA = "TEMPS MULTIWORK ETT";
const CIF = "B01130186";
const REPRESENTANTE = "SOLEDAD FERNANDEZ";
// La empresa usuaria a la que va el trabajador. De momento es fija; si algún día hace falta que
// cambie de un documento a otro, se puede leer de la hoja INFO del documento laboral.
const EMPRESA_USUARIA = "EUREST SERVICIOS";
const LUGAR = "MADRID";

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
  {
    // Información de riesgos de PharmaMar: 17 hojas apaisadas de las que solo se rellena la primera,
    // que es la cabecera con los datos del trabajador ("Nombre y Apellidos", "DNI", "Nombre Empresa"
    // y el recuadro de "Fecha y Firma del trabajador", donde va la captura de la firma digital).
    id: "pharmamar",
    boton: "PHARMAMAR",
    plantilla: "plantillas/pharmamar.pdf",
    archivo: (datos) => `DOCU ESPECIAL PHARMAMAR - ${datos.trabajador}.pdf`,
    pagina: 0,
    campos: [
      // El hueco del nombre llega hasta donde empieza "Fecha y Firma del trabajador:" (x=479,5)
      { valor: (d) => d.trabajador, x: 120.4, y: 90.1, tamano: 9, ancho: 340 },
      { valor: (d) => d.dni, x: 58.3, y: 109.2, tamano: 9, ancho: 120 },
      // La empresa es siempre la nuestra, así que va fija
      { valor: () => "TEMPS ETT MULTIWORK S.L.", x: 111.3, y: 128, tamano: 9, ancho: 200 },
      { imagen: (d) => d.firma, x: 601.5, y: 83.5, ancho: 124, alto: 54 },
    ],
  },
  {
    // Dos documentos de TALGO: el registro de medio ambiente y el acuse de recibo de información.
    id: "talgo",
    boton: "TALGO",
    documentos: [
      {
        plantilla: "plantillas/talgo-medio-ambiente.pdf",
        archivo: (datos) => `REGISTRO DE MEDIO AMBIENTE TALGO - ${datos.trabajador}.pdf`,
        pagina: 0, // son 4 hojas y solo se rellena la primera
        campos: [
          { valor: () => EMPRESA, x: 196, y: 128.5, tamano: 11, ancho: 330 },
          { valor: () => "TALGO LAS MATAS II", x: 359, y: 153.9, tamano: 11, ancho: 174 },
          { valor: (d) => d.puesto, x: 247, y: 179.3, tamano: 11, ancho: 283 },
          // La X de "¿VA A GENERAR RESIDUOS?  [ ] NO": la casilla va de 229,4 a 243,1
          { valor: () => "X", x: 236.2, y: 228.2, tamano: 11, ancho: 12, centrado: true },
          // Primera fila de la tabla (81,2 | 332,9 | 410,6 | 516,4; la fila va de 440,9 a 470,6)
          { valor: (d) => d.trabajador, x: 207, y: 459.6, tamano: 11, ancho: 240, centrado: true },
          { valor: (d) => fechaCorta(d.fecha), x: 371.8, y: 459.6, tamano: 11, ancho: 70, centrado: true },
          { imagen: (d) => d.firma, x: 414, y: 443, ancho: 98, alto: 25, centrado: true },
          // "……………, a ……. de ……………… de 20…"
          { valor: () => LUGAR, x: 250, y: 733.9, tamano: 11, ancho: 104, centrado: true },
          { valor: (d) => dosCifras(d.fecha.getDate()), x: 348.6, y: 733.9, tamano: 11, ancho: 44, centrado: true },
          { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 433, y: 733.9, tamano: 11, ancho: 88, centrado: true },
          { valor: (d) => String(d.fecha.getFullYear()).slice(-2), x: 516.8, y: 733.9, tamano: 11, ancho: 13, centrado: true },
          { imagen: (d) => d.sello, x: 365, y: 752, ancho: 80, alto: 58 }, // "Firma y sello de la contrata"
        ],
      },
      {
        plantilla: "plantillas/talgo-acuse.pdf",
        archivo: (datos) => `ACUSE RECIBO TALGO - ${datos.trabajador}.pdf`,
        pagina: 0,
        campos: [
          // "D. ________ como ________ de la EMPRESA / ________ que va a efectuar trabajos para…"
          { valor: (d) => d.trabajador, x: 176, y: 164.1, tamano: 11, ancho: 212, centrado: true },
          { valor: (d) => d.puesto, x: 392, y: 164.1, tamano: 11, ancho: 150, centrado: true },
          { valor: () => EMPRESA, x: 133, y: 178.6, tamano: 11, ancho: 150, centrado: true },
          // La X de la casilla "62 - LAS MATAS II", que va de 303,6 a 315,1
          { valor: () => "X", x: 309.4, y: 341, tamano: 11, ancho: 12, centrado: true },
          { valor: () => EMPRESA, x: 420.8, y: 494.5, tamano: 11, ancho: 232, centrado: true },
          // Primera fila de la tabla (56,8 | 276,4 | 396,8 | 474,8; la fila va de 550,4 a 568)
          { valor: (d) => d.apellidos, x: 166.6, y: 562.5, tamano: 10, ancho: 212, centrado: true },
          { valor: (d) => d.nombre, x: 336.6, y: 562.5, tamano: 10, ancho: 114, centrado: true },
          { valor: (d) => fechaCorta(d.fecha), x: 435.8, y: 562.5, tamano: 10, ancho: 72, centrado: true },
          // La casilla de la firma es muy bajita: la firma se centra dentro para no pisar las rayas
          { imagen: (d) => d.firma, x: 476, y: 551.5, ancho: 61, alto: 15.5, centrado: true },
          // "……………….. a ……de ……………….de 20.…"
          { valor: () => LUGAR, x: 112.6, y: 716.1, tamano: 11, ancho: 108, centrado: true },
          { valor: (d) => dosCifras(d.fecha.getDate()), x: 194, y: 716.1, tamano: 11, ancho: 28, centrado: true },
          { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 269, y: 716.1, tamano: 11, ancho: 88, centrado: true },
          { valor: (d) => String(d.fecha.getFullYear()).slice(-2), x: 345.5, y: 716.1, tamano: 11, ancho: 13, centrado: true },
          { imagen: (d) => d.sello, x: 190, y: 740, ancho: 80, alto: 58 }, // "Firma y sello de la contrata"
        ],
      },
    ],
  },
  {
    // Registro de entrega de información: son 4 hojas y solo se rellena el cuadro de la última.
    id: "merck-tres-cantos",
    boton: "MERCK TRES CANTOS",
    plantilla: "plantillas/merck-tres-cantos.pdf",
    archivo: (datos) => `DOCU ESPECIAL MERCK TRES CANTOS - ${datos.trabajador}.pdf`,
    pagina: -1,
    campos: [
      // Las cuatro filas del cuadro: la columna de los valores empieza en 146,5
      { valor: (d) => d.trabajador, x: 152, y: 601.8, tamano: 10, ancho: 412 },
      { valor: () => EMPRESA, x: 152, y: 630.6, tamano: 10, ancho: 412 },
      { valor: (d) => fechaCorta(d.fecha), x: 152, y: 659.5, tamano: 10, ancho: 412 },
      { imagen: (d) => d.firma, x: 152, y: 673, ancho: 130, alto: 31 },
    ],
  },
  {
    // Ficha informativa de riesgos: 3 hojas, y la tabla de firmas está en la última.
    id: "montesa-honda",
    boton: "MONTESA HONDA",
    plantilla: "plantillas/montesa-honda.pdf",
    archivo: (datos) => `DOCU ESPECIAL MONTESA HONDA - ${datos.trabajador}.pdf`,
    pagina: -1,
    campos: [
      // Tabla (72,6 | 203,2 | 339 | 452,3 | 545,4; la fila va de 496,9 a 565,3), rellenada como en
      // el documento de ejemplo: nosotros como empresa principal, la empresa usuaria como
      // contratada, y en la columna del trabajador su nombre con la firma justo debajo.
      { valor: () => "TEMPS MULTIWORK SL ETT", x: 137.9, y: 518.5, tamano: 9, ancho: 124, centrado: true },
      { valor: () => EMPRESA_USUARIA, x: 271.1, y: 520.5, tamano: 10, ancho: 128, centrado: true },
      // El nombre va con los apellidos delante, y cabe en dos renglones porque la casilla es estrecha
      { valor: (d) => `${d.apellidos}, ${d.nombre}`, x: 345, y: 508, tamano: 8, ancho: 105, lineas: 2, interlineado: 9.5 },
      { imagen: (d) => d.firma, x: 341, y: 521, ancho: 110, alto: 43, centrado: true },
      { valor: (d) => fechaCorta(d.fecha), x: 498.9, y: 521.5, tamano: 11, ancho: 86, centrado: true },
    ],
  },
  {
    id: "plastipak",
    boton: "PLASTIPAK",
    plantilla: "plantillas/plastipak.pdf",
    archivo: (datos) => `DOCU ESPECIAL PLASTIPAK - ${datos.trabajador}.pdf`,
    pagina: 0, // la hoja es tamaño carta, no A4
    campos: [
      { valor: () => EMPRESA, x: 160, y: 176.8, tamano: 11, ancho: 375 },
      // Primera fila de la tabla (57,4 | 305,4 | 390,6 | 560,8; la fila va de 341,6 a 382,4)
      { valor: (d) => d.trabajador, x: 181.4, y: 365.9, tamano: 11, ancho: 240, centrado: true },
      { valor: (d) => fechaCorta(d.fecha), x: 348, y: 365.9, tamano: 11, ancho: 78, centrado: true },
      { imagen: (d) => d.firma, x: 394, y: 344, ancho: 163, alto: 36, centrado: true },
    ],
  },
  {
    // Anexo de PRL de Telefónica. El impreso relleno a mano mezclaba letras de 9, 12 y 18 puntos;
    // aquí va todo a 11, del tamaño del texto del propio documento.
    id: "telefonica",
    boton: "TELEFONICA",
    plantilla: "plantillas/telefonica.pdf",
    archivo: (datos) => `DOCU ESPECIAL TELEFONICA - ${datos.trabajador}.pdf`,
    pagina: 0,
    campos: [
      // "la empresa ……………… con N.I.F. / C.I.F……., y en su nombre D./Dña. ………………,"
      { valor: () => EMPRESA, x: 382.7, y: 256, tamano: 11, ancho: 196, centrado: true },
      // El hueco del C.I.F. es muy corto, así que este va algo más pequeño a la fuerza
      { valor: () => CIF, x: 129.2, y: 269, tamano: 8.5, ancho: 42, centrado: true },
      { valor: () => REPRESENTANTE, x: 419.3, y: 269, tamano: 11, ancho: 238, centrado: true },
      // La fila de la tabla (90 | 162 | 401,6 | 527,8; la fila va de 420,5 a 473,3)
      { valor: (d) => d.dni, x: 126, y: 450.8, tamano: 11, ancho: 66, centrado: true },
      { valor: (d) => d.trabajador, x: 281.8, y: 450.8, tamano: 11, ancho: 230, centrado: true },
      { imagen: (d) => d.firma, x: 405, y: 424, ancho: 119, alto: 45, centrado: true },
      { imagen: (d) => d.sello, x: 300, y: 505, ancho: 100, alto: 74 }, // "Firma y sello de la empresa:"
      // El bloque de abajo, tal y como se venía rellenando a mano
      { valor: (d) => d.puesto, x: 116, y: 605, tamano: 11, ancho: 300 },
      { valor: (d) => d.trabajador, x: 172, y: 623, tamano: 11, ancho: 300 },
      // Aquí va el DNI del trabajador: el C.I.F. de la empresa ya está arriba, en su sitio
      { valor: (d) => d.dni, x: 105, y: 640.9, tamano: 11, ancho: 300 },
      // "En……………… a …… de ………… de 20…."
      { valor: () => LUGAR, x: 359.4, y: 710, tamano: 11, ancho: 76, centrado: true },
      { valor: (d) => dosCifras(d.fecha.getDate()), x: 418.8, y: 710, tamano: 11, ancho: 17, centrado: true },
      // El hueco del mes son 57 puntos, así que un mes largo como SEPTIEMBRE se encoge a la fuerza
      { valor: (d) => MESES[d.fecha.getMonth()].toUpperCase(), x: 473.5, y: 710, tamano: 11, ancho: 57, centrado: true },
      { valor: (d) => String(d.fecha.getFullYear()).slice(-2), x: 537.6, y: 710, tamano: 11, ancho: 13, centrado: true },
    ],
  },
];

// Los botones de los dos estadios van siempre los primeros: son documentos de sitios concretos
// (los campos de fútbol) y se piden mucho. Los demás, por orden alfabético, para encontrarlos de
// un vistazo sin tener que leerlos todos.
const PRIMEROS = ["real-madrid", "atleti"];

/** Los documentos especiales en el orden en que se ponen los botones en la pantalla. */
export function ordenados() {
  const primeros = PRIMEROS.map((id) => ESPECIALES.find((e) => e.id === id)).filter(Boolean);
  const resto = ESPECIALES.filter((e) => !PRIMEROS.includes(e.id))
    .sort((a, b) => a.boton.localeCompare(b.boton, "es"));
  return [...primeros, ...resto];
}

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

/**
 * Pega una imagen (la firma o el sello) dentro del hueco que marca el campo. La imagen se encoge
 * lo justo para caber sin deformarse; con "centrado" queda en el medio del hueco y, si no, pegada
 * a su esquina de arriba a la izquierda, que es como estaban hechos los documentos más antiguos.
 * Centrarla es lo que permite meter una firma en la casilla de una tabla sin taparle las rayas.
 */
async function pegarImagen(doc, pagina, bytes, campo, operadores) {
  if (!bytes) return;
  const imagen = await incrustarImagen(doc, bytes);
  const escala = Math.min(campo.ancho / imagen.ancho, campo.alto / imagen.alto);
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  const x = campo.centrado ? campo.x + (campo.ancho - ancho) / 2 : campo.x;
  const y = campo.centrado ? campo.y + (campo.alto - alto) / 2 : campo.y;
  const nombre = anadirRecurso(doc, pagina, "XObject", "ImgEspecial", imagen.ref);
  const matriz = multiplicar([ancho, 0, 0, -alto, x, y + alto], invertir(transformacion(doc, pagina)));
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
