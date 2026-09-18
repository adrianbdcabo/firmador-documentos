// Pruebas con los documentos de ejemplo (no están en el repositorio: contienen datos personales).
// Por defecto se buscan en ~/DOCUMENTOS DE EJEMPLO; se puede cambiar con FIRMADOR_EJEMPLOS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { ESPECIALES, generar } from "../js/especiales.js";
import { fechaDeHoy } from "../js/fecha.js";
import { deHojaSuelta, desdeImagen, desdePdf } from "../js/firma.js";
import { ErrorProcesado, FirmaNoEncontrada, firmante, procesar } from "../js/pdf.js";
import { abrirPdf, guardar, lineasDeTexto, mupdf } from "../js/pdfutil.js";

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

function llevaImagen(bytes, png, indice = 0) {
  const esperada = new mupdf.Image(png).toPixmap();
  // Copia: getPixels() apunta a la memoria de MuPDF y deja de valer si esta crece al leer más imágenes.
  const pixeles = esperada.getPixels().slice();
  return imagenes(bytes, indice).some((im) => im.ancho === esperada.getWidth() && im.alto === esperada.getHeight() &&
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

  test("el sello es opcional", () => {
    const datos = leer(DOCS.Y6912244E.archivo);
    const sinSello = procesar(datos, {});
    const conSello = procesar(datos, { sello: SELLO });
    sinSello.hojas.forEach((hoja, i) => {
      const antes = imagenes(datos, hoja.paginaOrigen - 1).length;
      assert.equal(imagenes(hoja.pdf).length, antes + 1, `${hoja.clave}: sin sello solo se pega la firma`);
      assert.equal(imagenes(conSello.hojas[i].pdf).length, antes + ESPERADO[hoja.clave].length, `${hoja.clave}: con sello`);
    });
  });

  test("errores controlados", () => {
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

  const HECHAS = ["INFO HECHA.pdf", "EPI HECHA.pdf", "REN HECHA.pdf"];

  test("firma sacada de una hoja ya hecha (INFO, EPI o REN)", { skip: !HECHAS.every(existe) }, () => {
    for (const archivo of HECHAS) {
      const datos = leer(archivo);
      const firma = desdePdf(datos, archivo);
      assert.equal(firma.nombre, "CINTHIA OSAFAMEN", archivo);
      assert.equal(firma.nif, "Y6912244E", archivo);
      const imagen = new mupdf.Image(firma.imagen);
      assert.deepEqual([imagen.getWidth(), imagen.getHeight()], [174, 76], `${archivo}: es la firma, no el sello ni un logo`);

      // Sirve para firmar el documento de otra persona (avisando de que es de otra)
      const resultado = procesar(sinFirmar(leer(DOCS["53850518C"].archivo)), { imagenFirma: firma.imagen, sello: SELLO });
      assert.ok(resultado.hojas.every((h) => llevaImagen(h.pdf, firma.imagen)), archivo);
      assert.equal(firma.esDe(resultado.dni), false, archivo);

      // Y se reconoce como hoja suelta si se carga en «Cargar documentos laborales»
      const suelta = deHojaSuelta(datos, archivo);
      assert.equal(suelta?.nif, "Y6912244E", archivo);
    }
    assert.equal(deHojaSuelta(leer(DOCS.Y6912244E.archivo), "global"), null, "el documento global no es una hoja suelta");
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

  test("documento especial de IESE MADRID relleno", () => {
    const especial = ESPECIALES.find((e) => e.id === "iese-madrid");
    const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
    const resultado = procesar(leer(DOCS["51143385X"].archivo), { sello: SELLO });
    const datos = {
      trabajador: resultado.trabajador,
      dni: resultado.dni,
      puesto: resultado.puesto,
      firma: resultado.firma,
      fecha: new Date(2026, 8, 17),
    };
    assert.equal(datos.puesto.length > 0, true, "se lee el puesto del documento laboral");
    assert.equal(especial.archivo(datos), `DOCU ESPECIAL IESE MADRID - ${resultado.trabajador}.pdf`);

    const pdf = generar(especial, plantilla, datos);
    const doc = new mupdf.PDFDocument(pdf);
    assert.equal(doc.countPages(), 8);
    const ultima = doc.countPages() - 1;
    const texto = doc.loadPage(ultima).toStructuredText("preserve-whitespace").asText().replace(/\s+/g, " ");
    for (const esperado of [resultado.trabajador, resultado.dni, "17", "SEPTIEMBRE", "26"]) {
      assert.ok(texto.includes(esperado), `falta "${esperado}" en el documento especial`);
    }
    assert.ok(llevaImagen(pdf, datos.firma, ultima), "lleva la firma del trabajador");

    // Un nombre muy largo se encoge para no salirse de su hueco
    const largo = generar(especial, plantilla, { ...datos, trabajador: "MARIA DEL CARMEN FERNANDEZ DE LA HOZ ECHEVARRIA" });
    const lineas = lineasDeTexto(new mupdf.PDFDocument(largo).loadPage(ultima));
    const linea = lineas.find((l) => l.chars.map((c) => c.c).join("").includes("MARIA DEL CARMEN"));
    assert.ok(linea, "el nombre largo está en el documento");
    assert.ok(linea.bbox[2] - linea.bbox[0] <= 200, `el nombre largo cabe (mide ${(linea.bbox[2] - linea.bbox[0]).toFixed(0)} pt)`);
  });

  test("documentos especiales de REAL MADRID, ATLETI y CUN MADRID rellenos", () => {
    const resultado = procesar(leer(DOCS["51143385X"].archivo), { sello: SELLO });
    const datos = {
      trabajador: resultado.trabajador,
      dni: resultado.dni,
      puesto: resultado.puesto,
      firma: resultado.firma,
      fecha: new Date(2026, 8, 18),
    };
    for (const [id, paginas, archivo, esperados] of [
      ["real-madrid", 1, "REAL MADRID", ["18 de Septiembre de 2026", "18 de Septiembre de", "2026"]],
      ["atleti", 2, "ATLETI", ["18/09/2026"]],
      ["cun-madrid", 8, "CUN MADRID", ["18", "SEPTIEMBRE", "26"]],
    ]) {
      const especial = ESPECIALES.find((e) => e.id === id);
      assert.equal(especial.archivo(datos), `DOCU ESPECIAL ${archivo} - ${resultado.trabajador}.pdf`);
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
      const pdf = generar(especial, plantilla, datos);
      const doc = new mupdf.PDFDocument(pdf);
      assert.equal(doc.countPages(), paginas, `${id}: páginas`);
      const pagina = especial.pagina < 0 ? doc.countPages() + especial.pagina : especial.pagina;
      const lineas = doc.loadPage(pagina).toStructuredText().asText().split("\n").map((l) => l.trim());
      for (const esperado of [resultado.trabajador, resultado.dni, ...esperados]) {
        assert.ok(lineas.includes(esperado), `${id}: falta "${esperado}"`);
      }
      assert.ok(llevaImagen(pdf, datos.firma, pagina), `${id}: lleva la firma del trabajador`);
    }
  });

  test("en los documentos especiales un nombre larguísimo no se sale de su hueco", () => {
    const largo = "MARIA DEL CARMEN FERNANDEZ DE LA HOZ ECHEVARRIA GUTIERREZ";
    const datos = { trabajador: largo, dni: "12345678Z", fecha: new Date(2027, 1, 28), firma: null };
    for (const especial of ESPECIALES) {
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
      const doc = new mupdf.PDFDocument(generar(especial, plantilla, datos));
      const indice = especial.pagina < 0 ? doc.countPages() + especial.pagina : especial.pagina;
      const huecos = especial.campos.filter((c) => c.valor && c.valor(datos) === largo)
        .map((c) => (c.centrado ? [c.x - c.ancho / 2, c.x + c.ancho / 2] : [c.x, c.x + c.ancho]));
      const tramos = [];
      doc.loadPage(indice).toStructuredText().walk({
        beginLine() { this.c = []; },
        onChar(c, _o, _f, _s, quad) { this.c.push([c, quad[0], quad[2]]); },
        endLine() {
          const k = this.c.map((x) => x[0]).join("").indexOf(largo);
          if (k >= 0) tramos.push([this.c[k][1], this.c[k + largo.length - 1][2]]);
        },
      });
      assert.equal(tramos.length, huecos.length, `${especial.boton}: el nombre sale en todos sus huecos`);
      tramos.sort((a, b) => a[0] - b[0]);
      huecos.sort((a, b) => a[0] - b[0]);
      tramos.forEach(([ini, fin], i) => {
        assert.ok(ini >= huecos[i][0] - 0.5 && fin <= huecos[i][1] + 0.5, `${especial.boton}: ${ini.toFixed(1)}-${fin.toFixed(1)} fuera de ${huecos[i]}`);
      });
    }
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
