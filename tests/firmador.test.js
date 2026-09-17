// Pruebas con los documentos de ejemplo (no están en el repositorio: contienen datos personales).
// Por defecto se buscan en ~/DOCUMENTOS DE EJEMPLO; se puede cambiar con FIRMADOR_EJEMPLOS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { fechaDeHoy } from "../js/fecha.js";
import { desdeImagen, desdePdf } from "../js/firma.js";
import { ErrorProcesado, FirmaNoEncontrada, firmante, procesar } from "../js/pdf.js";
import { abrirPdf, guardar, mupdf } from "../js/pdfutil.js";

const EJEMPLOS = process.env.FIRMADOR_EJEMPLOS ?? path.join(os.homedir(), "DOCUMENTOS DE EJEMPLO");
const existe = (nombre) => fs.existsSync(path.join(EJEMPLOS, nombre));
const leer = (nombre) => new Uint8Array(fs.readFileSync(path.join(EJEMPLOS, nombre)));

const DOCS = {
  Y6912244E: { archivo: "DOCUMENTO GLOBAL.pdf", nombre: "CINTHIA OSAFAMEN", paginas: [1, 4, 15] },
  "09818735N": { archivo: "Doc_Laborales300_20260915-30750-09818735N.pdf", nombre: "MOHAMED CHAKIR EL MAKHLOUFI IDRISSI", paginas: [1, 5, 16] },
  "51143385X": { archivo: "Doc_Laborales300_20260916-30828-51143385X.pdf", nombre: "IGNACIO CARLOS PUCHOL VIÑA", paginas: [1, 4, 15] },
  "53850518C": { archivo: "Doc_Laborales300_20260917-30816-53850518C.pdf", nombre: "CARLOS GARCIA ALONSO", paginas: [1, 8, 19] },
};
const hayEjemplos = Object.values(DOCS).every((d) => existe(d.archivo)) && existe("FOTO SELLO TEMPS.jpeg");
const SELLO = hayEjemplos ? leer("FOTO SELLO TEMPS.jpeg") : null;
const CAPTURA = "FOTO FIRMA DE EJEMPLO.jpeg";

// Esquina superior izquierda de las imágenes pegadas a mano en INFO/EPI/REN HECHA.
const ESPERADO = {
  INFO: [[41.0, 661.6], [325.5, 610.1]],
  EPI: [[368.4, 608.6]],
  REN: [[42.1, 742.1], [349.9, 659.9]],
};

const FECHA_ORIGINAL = "16 de Septiembre de 2026";
const DIFICIL = "27 de Julio de 2027"; // el 7 y la J no vienen en la Arial Narrow de EPI

function paginaDe(bytes, indice = 0) {
  const doc = new mupdf.PDFDocument(bytes);
  return { doc, pagina: doc.loadPage(indice) };
}

function texto(bytes) {
  const { pagina } = paginaDe(bytes);
  return pagina.toStructuredText("preserve-whitespace").asText().replace(/ /g, " ");
}

function imagenes(bytes, indice = 0) {
  const { pagina } = paginaDe(bytes, indice);
  const lista = [];
  pagina.toStructuredText("preserve-images").walk({
    onImageBlock(bbox, _t, imagen) {
      const pix = imagen.toPixmap();
      lista.push({ bbox, ancho: imagen.getWidth(), alto: imagen.getHeight(), pixeles: pix.getPixels().slice(), n: pix.getNumberOfComponents() });
    },
  });
  return lista;
}

function llevaImagen(bytes, png) {
  const esperada = new mupdf.Image(png).toPixmap();
  const pixeles = esperada.getPixels();
  return imagenes(bytes).some((im) => im.ancho === esperada.getWidth() && im.alto === esperada.getHeight() &&
    im.pixeles.length === pixeles.length && im.pixeles.every((v, i) => v === pixeles[i]));
}

function pixeles(bytes, ppp = 100) {
  const { pagina } = paginaDe(bytes);
  const z = ppp / 72;
  return pagina.toPixmap(mupdf.Matrix.scale(z, z), mupdf.ColorSpace.DeviceRGB, false, true).getPixels().slice();
}

function sinFirmar(bytes) {
  const origen = abrirPdf(bytes);
  const destino = new mupdf.PDFDocument();
  for (let i = 0; i < origen.countPages(); i++) destino.graftPage(-1, origen, i);
  return guardar(destino);
}

const palabras = (t) => t.split(/\s+/).filter(Boolean).sort();

describe("firmador", { skip: !hayEjemplos && "faltan los documentos de ejemplo" }, () => {
  test("localiza las hojas, el trabajador, el DNI y el firmante en los 4 documentos", () => {
    for (const [nif, doc] of Object.entries(DOCS)) {
      const datos = leer(doc.archivo);
      const resultado = procesar(datos, { sello: SELLO });
      assert.deepEqual(resultado.hojas.map((h) => h.paginaOrigen), doc.paginas, doc.archivo);
      assert.equal(resultado.trabajador, doc.nombre);
      assert.equal(resultado.dni, nif);
      const firma = desdePdf(datos, doc.archivo);
      assert.deepEqual([firma.nombre, firma.nif], [doc.nombre, nif]);
      assert.ok(firma.esDe(resultado.dni));
      assert.deepEqual(firmante(abrirPdf(datos)), [doc.nombre, nif]);
    }
  });

  test("firma y sello en la misma posición que las hojas hechas a mano", () => {
    const datos = leer(DOCS.Y6912244E.archivo);
    const resultado = procesar(datos, { sello: SELLO });
    for (const hoja of resultado.hojas) {
      const antes = new Set(imagenes(datos, hoja.paginaOrigen - 1).map((im) => im.bbox.map(Math.round).join()));
      const nuevas = imagenes(hoja.pdf).filter((im) => !antes.has(im.bbox.map(Math.round).join()));
      nuevas.sort((a, b) => (a.bbox[2] - a.bbox[0]) - (b.bbox[2] - b.bbox[0])); // primero la firma (la más pequeña)
      assert.equal(nuevas.length, ESPERADO[hoja.clave].length, hoja.clave);
      nuevas.forEach((im, i) => {
        const [x, y] = ESPERADO[hoja.clave][i];
        assert.ok(Math.abs(im.bbox[0] - x) < 3 && Math.abs(im.bbox[1] - y) < 3, `${hoja.clave}: ${im.bbox} frente a ${x},${y}`);
      });
      assert.equal(paginaDe(hoja.pdf).pagina.getWidgets().length, 0, "no debe arrastrar el campo de firma");
    }
    assert.equal(new mupdf.PDFDocument(resultado.pack()).countPages(), 3);
  });

  test("errores controlados", () => {
    assert.throws(() => procesar(leer(DOCS.Y6912244E.archivo), {}), ErrorProcesado);
    assert.throws(() => procesar(new TextEncoder().encode("esto no es un pdf"), { sello: SELLO }), ErrorProcesado);
    assert.throws(() => procesar(sinFirmar(leer(DOCS["51143385X"].archivo)), { sello: SELLO }), FirmaNoEncontrada);
    assert.throws(() => desdePdf(sinFirmar(leer(DOCS.Y6912244E.archivo)), "x"), FirmaNoEncontrada);
  });

  test("firma cargada de otro PDF: en un documento sin firmar y sustituyendo a la del documento", () => {
    const cinthia = desdePdf(leer(DOCS.Y6912244E.archivo), "global");
    const carlos = leer(DOCS["53850518C"].archivo);
    const sinFirma = procesar(sinFirmar(carlos), { sello: SELLO, imagenFirma: cinthia.imagen });
    assert.ok(sinFirma.hojas.every((h) => llevaImagen(h.pdf, cinthia.imagen)));
    assert.equal(cinthia.esDe(sinFirma.dni), false);

    const propia = desdePdf(carlos, "carlos");
    const sustituida = procesar(carlos, { sello: SELLO, imagenFirma: cinthia.imagen });
    for (const hoja of sustituida.hojas) {
      assert.ok(llevaImagen(hoja.pdf, cinthia.imagen), hoja.clave);
      assert.ok(!llevaImagen(hoja.pdf, propia.imagen), hoja.clave);
    }
  });

  test("firma desde una captura de pantalla", { skip: !existe(CAPTURA) }, () => {
    const firma = desdeImagen(leer(CAPTURA), CAPTURA);
    const im = new mupdf.Image(firma.imagen);
    assert.ok(im.getWidth() <= 174 && im.getHeight() <= 76, "se recorta el margen");
    assert.ok(firma.esDe("CUALQUIERA"));
    const resultado = procesar(sinFirmar(leer(DOCS["09818735N"].archivo)), { sello: SELLO, imagenFirma: firma.imagen, fecha: DIFICIL });
    assert.ok(resultado.hojas.every((h) => llevaImagen(h.pdf, firma.imagen)));
    assert.deepEqual(resultado.avisos, []);

    const blanco = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 50, 20], false);
    blanco.clear(255);
    assert.throws(() => desdeImagen(blanco.asPNG(), "x"), /en blanco/);
    assert.throws(() => desdeImagen(new TextEncoder().encode("no es una imagen"), "x"), ErrorProcesado);
  });

  test("formato de la fecha de hoy", () => {
    assert.equal(fechaDeHoy(new Date(2026, 9, 5)), "5 de Octubre de 2026");
    assert.equal(fechaDeHoy(new Date(2027, 2, 17)), "17 de Marzo de 2027");
  });

  test("reescribir la misma fecha no cambia ni un píxel", () => {
    const resultado = procesar(leer(DOCS.Y6912244E.archivo), { sello: SELLO, fecha: FECHA_ORIGINAL });
    for (const hoja of resultado.hojas) {
      assert.notDeepEqual(hoja.pdf, hoja.pdfOriginal, "se ha reescrito de verdad");
      assert.deepEqual(pixeles(hoja.pdf), pixeles(hoja.pdfOriginal), hoja.clave);
    }
  });

  test("cambia la fecha sin tocar el resto y vuelve a la original", () => {
    const resultado = procesar(leer(DOCS.Y6912244E.archivo), { sello: SELLO });
    const originales = resultado.hojas.map((h) => h.pdf);
    assert.deepEqual(resultado.ponerFecha(DIFICIL), []);
    for (const hoja of resultado.hojas) {
      const nuevo = texto(hoja.pdf);
      assert.ok(!nuevo.includes(FECHA_ORIGINAL), hoja.clave);
      assert.deepEqual(palabras(nuevo), palabras(texto(hoja.pdfOriginal).replace(FECHA_ORIGINAL, DIFICIL)), hoja.clave);
    }
    assert.ok(texto(resultado.hojas[1].pdf).includes(`${DIFICIL}.`), "EPI conserva el punto final");
    resultado.ponerFecha(null);
    assert.deepEqual(resultado.hojas.map((h) => h.pdf), originales);
  });

  test("todos los meses y dígitos en los 4 documentos", () => {
    for (const doc of Object.values(DOCS)) {
      const resultado = procesar(leer(doc.archivo), { sello: SELLO });
      for (let mes = 0; mes < 12; mes++) {
        for (const dia of [1, 17, 28]) {
          const fecha = fechaDeHoy(new Date(2027 + (mes % 4), mes, dia));
          assert.deepEqual(resultado.ponerFecha(fecha), [], `${doc.archivo} ${fecha}`);
          for (const hoja of resultado.hojas) assert.ok(texto(hoja.pdf).includes(fecha), `${doc.archivo} ${hoja.clave} ${fecha}`);
        }
      }
    }
  });
});
