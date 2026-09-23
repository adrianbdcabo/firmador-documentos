// © 2026 Adrián Barroso de Cabo.
// Pruebas con los documentos de ejemplo (no están en el repositorio: contienen datos personales).
// Por defecto se buscan en ~/DOCUMENTOS DE EJEMPLO; se puede cambiar con FIRMADOR_EJEMPLOS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { documentosDe, ESPECIALES, generar, ordenados } from "../js/especiales.js";
import { fechaDeHoy } from "../js/fecha.js";
import { deHojaSuelta, desdeImagen, desdePdf } from "../js/firma.js";
import { decodificar, png, pngParaPdf } from "../js/imagenes.js";
import { interpretar, lineasDeGlifos, textoDeLineas } from "../js/lector.js";
import { ErrorProcesado, FirmaNoEncontrada, campoFirma, firmante, procesar } from "../js/pdf.js";
import { PDFDocument, PDFName, abrirPdf, comoNumero, guardar, obtener } from "../js/pdfbase.js";
import { renderizar } from "../js/render.js";
import { esMasNuevo, horaBonita, leerITA } from "../js/itas.js";
import { generarTA2, nafFormateado } from "../js/ta2.js";

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
const ITA = "ita_1809_260920_215821.pdf";

// Esquina superior izquierda de las imágenes pegadas a mano en INFO/EPI/REN HECHA.
const ESPERADO = {
  INFO: [[41.0, 661.6], [325.5, 610.1]],
  EPI: [[368.4, 608.6]],
  REN: [[42.1, 742.1], [349.9, 659.9]],
};

const FECHA_ORIGINAL = "16 de Septiembre de 2026";
const DIFICIL = "27 de Julio de 2027"; // el 7 y la J no vienen en la Arial Narrow de EPI

async function paginaDe(bytes, indice = 0) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { doc, pagina: doc.getPage(indice) };
}

async function lineas(bytes, indice = 0) {
  const { doc, pagina } = await paginaDe(bytes, indice);
  return lineasDeGlifos(interpretar(doc, pagina).glifos);
}

async function texto(bytes, indice = 0) {
  return textoDeLineas(await lineas(bytes, indice)).replace(/ /g, " ");
}

async function paginas(bytes) {
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}

/** Imágenes de la página: caja, tamaño y datos (tal cual van en el PDF). */
async function imagenes(bytes, indice = 0) {
  const { doc, pagina } = await paginaDe(bytes, indice);
  return interpretar(doc, pagina).imagenes.filter((im) => im.objeto).map((im) => ({
    bbox: im.rect,
    ancho: comoNumero(obtener(doc, im.objeto, "Width")),
    alto: comoNumero(obtener(doc, im.objeto, "Height")),
    datos: im.objeto.contents ?? im.objeto.getContents?.(),
  }));
}

/** ¿Lleva la página esa imagen (PNG o JPG) tal cual? */
async function llevaImagen(bytes, archivo, indice = 0) {
  const esperados = pngParaPdf(archivo)?.comprimido ?? archivo;
  const iguales = (a, b) => a && a.length === b.length && a.every((v, i) => v === b[i]);
  return (await imagenes(bytes, indice)).some((im) => iguales(im.datos, esperados));
}

async function pixeles(bytes, ppp = 100) {
  return (await renderizar(bytes, { escala: ppp / 72 })).datos;
}

/** El mismo documento sin la firma digital (sin anotaciones ni campos). */
async function sinFirmar(bytes) {
  const origen = await abrirPdf(bytes);
  const destino = await PDFDocument.create();
  for (const pagina of origen.getPages()) pagina.node.delete(PDFName.of("Annots"));
  for (const pagina of await destino.copyPages(origen, origen.getPageIndices())) destino.addPage(pagina);
  return guardar(destino);
}

const tamanoPng = async (bytes) => {
  const imagen = await decodificar(bytes);
  return [imagen.ancho, imagen.alto];
};

const palabras = (t) => t.split(/\s+/).filter(Boolean).sort();

describe("firmador", { skip: !hayEjemplos && "faltan los documentos de ejemplo" }, () => {
  after(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref()); // el "worker" de pdf.js queda abierto

  test("localiza las hojas, el trabajador, el DNI y el firmante en los 4 documentos", async () => {
    for (const [nif, doc] of Object.entries(DOCS)) {
      const datos = leer(doc.archivo);
      const resultado = await procesar(datos, { sello: SELLO });
      assert.deepEqual(resultado.hojas.map((h) => h.paginaOrigen), doc.paginas, doc.archivo);
      assert.equal(resultado.trabajador, doc.nombre);
      assert.equal(resultado.dni, nif);
      const firma = await desdePdf(datos, doc.archivo);
      assert.deepEqual([firma.nombre, firma.nif], [doc.nombre, nif]);
      assert.ok(firma.esDe(resultado.dni));
      assert.deepEqual(firmante(await abrirPdf(datos)), [doc.nombre, nif]);
    }
  });

  test("firma y sello en la misma posición que las hojas hechas a mano", async () => {
    const datos = leer(DOCS.Y6912244E.archivo);
    const resultado = await procesar(datos, { sello: SELLO });
    for (const hoja of resultado.hojas) {
      const antes = new Set((await imagenes(datos, hoja.paginaOrigen - 1)).map((im) => im.bbox.map(Math.round).join()));
      const nuevas = (await imagenes(hoja.pdf)).filter((im) => !antes.has(im.bbox.map(Math.round).join()));
      nuevas.sort((a, b) => (a.bbox[2] - a.bbox[0]) - (b.bbox[2] - b.bbox[0])); // primero la firma (la más pequeña)
      assert.equal(nuevas.length, ESPERADO[hoja.clave].length, hoja.clave);
      nuevas.forEach((im, i) => {
        const [x, y] = ESPERADO[hoja.clave][i];
        assert.ok(Math.abs(im.bbox[0] - x) < 3 && Math.abs(im.bbox[1] - y) < 3, `${hoja.clave}: ${im.bbox} frente a ${x},${y}`);
      });
      assert.equal(campoFirma(await abrirPdf(hoja.pdf)), null, "no debe arrastrar el campo de firma");
    }
    assert.equal(await paginas(await resultado.pack()), 3);
  });

  test("el sello es opcional", async () => {
    const datos = leer(DOCS.Y6912244E.archivo);
    const sinSello = await procesar(datos, {});
    const conSello = await procesar(datos, { sello: SELLO });
    for (const [i, hoja] of sinSello.hojas.entries()) {
      const antes = (await imagenes(datos, hoja.paginaOrigen - 1)).length;
      assert.equal((await imagenes(hoja.pdf)).length, antes + 1, `${hoja.clave}: sin sello solo se pega la firma`);
      assert.equal((await imagenes(conSello.hojas[i].pdf)).length, antes + ESPERADO[hoja.clave].length, `${hoja.clave}: con sello`);
    }
  });

  test("errores controlados", async () => {
    await assert.rejects(procesar(new TextEncoder().encode("esto no es un pdf"), { sello: SELLO }), ErrorProcesado);
    await assert.rejects(procesar(await sinFirmar(leer(DOCS["51143385X"].archivo)), { sello: SELLO }), FirmaNoEncontrada);
    await assert.rejects(desdePdf(await sinFirmar(leer(DOCS.Y6912244E.archivo)), "x"), FirmaNoEncontrada);
  });

  test("firma cargada de otro PDF: en un documento sin firmar y sustituyendo a la del documento", async () => {
    const cinthia = await desdePdf(leer(DOCS.Y6912244E.archivo), "global");
    const carlos = leer(DOCS["53850518C"].archivo);
    const sinFirma = await procesar(await sinFirmar(carlos), { sello: SELLO, imagenFirma: cinthia.imagen });
    for (const hoja of sinFirma.hojas) assert.ok(await llevaImagen(hoja.pdf, cinthia.imagen), hoja.clave);
    assert.equal(cinthia.esDe(sinFirma.dni), false);

    const propia = await desdePdf(carlos, "carlos");
    const sustituida = await procesar(carlos, { sello: SELLO, imagenFirma: cinthia.imagen });
    for (const hoja of sustituida.hojas) {
      assert.ok(await llevaImagen(hoja.pdf, cinthia.imagen), hoja.clave);
      assert.ok(!(await llevaImagen(hoja.pdf, propia.imagen)), hoja.clave);
    }
  });

  const HECHAS = ["INFO HECHA.pdf", "EPI HECHA.pdf", "REN HECHA.pdf"];

  test("firma sacada de una hoja ya hecha (INFO, EPI o REN)", { skip: !HECHAS.every(existe) }, async () => {
    for (const archivo of HECHAS) {
      const datos = leer(archivo);
      const firma = await desdePdf(datos, archivo);
      assert.equal(firma.nombre, "CINTHIA OSAFAMEN", archivo);
      assert.equal(firma.nif, "Y6912244E", archivo);
      assert.deepEqual(await tamanoPng(firma.imagen), [174, 76], `${archivo}: es la firma, no el sello ni un logo`);

      // Sirve para firmar el documento de otra persona (avisando de que es de otra)
      const resultado = await procesar(await sinFirmar(leer(DOCS["53850518C"].archivo)), { imagenFirma: firma.imagen, sello: SELLO });
      for (const hoja of resultado.hojas) assert.ok(await llevaImagen(hoja.pdf, firma.imagen), archivo);
      assert.equal(firma.esDe(resultado.dni), false, archivo);

      // Y se reconoce como hoja suelta si se carga en «Cargar documentos laborales»
      const suelta = await deHojaSuelta(datos, archivo);
      assert.equal(suelta?.nif, "Y6912244E", archivo);
    }
    assert.equal(await deHojaSuelta(leer(DOCS.Y6912244E.archivo), "global"), null, "el documento global no es una hoja suelta");
  });

  test("firma desde una captura de pantalla", { skip: !existe(CAPTURA) }, async () => {
    const firma = await desdeImagen(leer(CAPTURA), CAPTURA);
    const [ancho, alto] = await tamanoPng(firma.imagen);
    assert.ok(ancho <= 174 && alto <= 76, "se recorta el margen");
    assert.ok(firma.esDe("CUALQUIERA"));
    const resultado = await procesar(await sinFirmar(leer(DOCS["09818735N"].archivo)), { sello: SELLO, imagenFirma: firma.imagen, fecha: DIFICIL });
    for (const hoja of resultado.hojas) assert.ok(await llevaImagen(hoja.pdf, firma.imagen), hoja.clave);
    assert.deepEqual(resultado.avisos, []);

    const blanco = await png({ ancho: 50, alto: 20, datos: new Uint8ClampedArray(50 * 20 * 4).fill(255) });
    await assert.rejects(desdeImagen(blanco, "x"), /en blanco/);
    await assert.rejects(desdeImagen(new TextEncoder().encode("no es una imagen"), "x"), ErrorProcesado);
  });

  test("documento especial de IESE MADRID relleno", async () => {
    const especial = ESPECIALES.find((e) => e.id === "iese-madrid");
    const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), { sello: SELLO });
    const datos = {
      trabajador: resultado.trabajador,
      dni: resultado.dni,
      puesto: resultado.puesto,
      firma: resultado.firma,
      fecha: new Date(2026, 8, 17),
    };
    assert.equal(datos.puesto.length > 0, true, "se lee el puesto del documento laboral");
    assert.equal(especial.archivo(datos), `DOCU ESPECIAL IESE MADRID - ${resultado.trabajador}.pdf`);

    const pdf = await generar(especial, plantilla, datos);
    assert.equal(await paginas(pdf), 8);
    const ultima = 7;
    const contenido = (await texto(pdf, ultima)).replace(/\s+/g, " ");
    for (const esperado of [resultado.trabajador, resultado.dni, "17", "SEPTIEMBRE", "26"]) {
      assert.ok(contenido.includes(esperado), `falta "${esperado}" en el documento especial`);
    }
    assert.ok(await llevaImagen(pdf, datos.firma, ultima), "lleva la firma del trabajador");

    // Un nombre muy largo se encoge para no salirse de su hueco
    const largo = await generar(especial, plantilla, { ...datos, trabajador: "MARIA DEL CARMEN FERNANDEZ DE LA HOZ ECHEVARRIA" });
    const linea = (await lineas(largo, ultima)).find((l) => l.chars.map((c) => c.c).join("").includes("MARIA DEL CARMEN"));
    assert.ok(linea, "el nombre largo está en el documento");
    assert.ok(linea.bbox[2] - linea.bbox[0] <= 200, `el nombre largo cabe (mide ${(linea.bbox[2] - linea.bbox[0]).toFixed(0)} pt)`);
  });

  test("documentos especiales de REAL MADRID, ATLETI, CUN MADRID y THALES rellenos", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), { sello: SELLO });
    const datos = {
      trabajador: resultado.trabajador,
      dni: resultado.dni,
      puesto: resultado.puesto,
      firma: resultado.firma,
      fecha: new Date(2026, 8, 18),
    };
    for (const [id, numeroPaginas, archivo, esperados] of [
      ["real-madrid", 1, "REAL MADRID", ["18 de Septiembre de 2026", "18 de Septiembre de", "2026"]],
      ["atleti", 2, "ATLETI", ["18/09/2026"]],
      ["cun-madrid", 8, "CUN MADRID", ["18", "SEPTIEMBRE", "26"]],
      ["thales", 2, "THALES", ["18/09/2026", resultado.puesto]],
    ]) {
      const especial = ESPECIALES.find((e) => e.id === id);
      assert.equal(especial.archivo(datos), `DOCU ESPECIAL ${archivo} - ${resultado.trabajador}.pdf`);
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
      const pdf = await generar(especial, plantilla, datos);
      assert.equal(await paginas(pdf), numeroPaginas, `${id}: páginas`);
      const pagina = especial.pagina < 0 ? numeroPaginas + especial.pagina : especial.pagina;
      const textos = (await texto(pdf, pagina)).split("\n").map((l) => l.trim());
      for (const esperado of [resultado.trabajador, resultado.dni, ...esperados]) {
        assert.ok(textos.includes(esperado), `${id}: falta "${esperado}"`);
      }
      assert.ok(await llevaImagen(pdf, datos.firma, pagina), `${id}: lleva la firma del trabajador`);
    }
  });

  test("SANDOZ descarga dos documentos: el recibí y la información de riesgos con el sello", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = { trabajador: resultado.trabajador, dni: resultado.dni, puesto: resultado.puesto, firma: resultado.firma, sello: SELLO, fecha: new Date(2026, 8, 18) };
    const [recibi, info] = documentosDe(ESPECIALES.find((e) => e.id === "sandoz"));
    assert.equal(recibi.archivo(datos), `RECIBI SANDOZ - ${resultado.trabajador}.pdf`);
    assert.equal(info.archivo(datos), `INFO SANDOZ - ${resultado.trabajador}.pdf`);
    for (const [documento, numeroPaginas, esperados, conSello] of [
      [recibi, 4, [resultado.trabajador, "18/09/2026"], false],
      [info, 1, ["18/09/2026"], true],
    ]) {
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${documento.plantilla}`, import.meta.url)));
      const pdf = await generar(documento, plantilla, datos);
      assert.equal(await paginas(pdf), numeroPaginas);
      const pagina = documento.pagina < 0 ? numeroPaginas + documento.pagina : documento.pagina;
      const textos = (await texto(pdf, pagina)).split("\n").map((l) => l.trim());
      for (const esperado of esperados) assert.ok(textos.includes(esperado), `${documento.archivo(datos)}: falta "${esperado}"`);
      assert.ok(await llevaImagen(pdf, datos.firma, pagina), "lleva la firma");
      assert.equal(await llevaImagen(pdf, SELLO, pagina), conSello, "sello");
    }
  });

  test("CEPSA descarga dos documentos: ANEXO 12 (con el sello) y ANEXO 24 (con el puesto)", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = { trabajador: resultado.trabajador, dni: resultado.dni, puesto: resultado.puesto, firma: resultado.firma, sello: SELLO, fecha: new Date(2026, 8, 18) };
    const [anexo12, anexo24] = documentosDe(ESPECIALES.find((e) => e.id === "cepsa"));
    assert.equal(anexo12.archivo(datos), `ANEXO 12 CEPSA - ${resultado.trabajador}.pdf`);
    assert.equal(anexo24.archivo(datos), `ANEXO 24 CEPSA - ${resultado.trabajador}.pdf`);
    for (const [documento, esperados, conSello] of [
      [anexo12, ["18 DE SEPTIEMBRE DE 2026", resultado.trabajador, resultado.dni], true],
      [anexo24, [resultado.trabajador, resultado.dni, resultado.puesto, "18", "SEPTIEMBRE", "2026"], false],
    ]) {
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${documento.plantilla}`, import.meta.url)));
      const antes = (await imagenes(plantilla)).length;
      const pdf = await generar(documento, plantilla, datos);
      const contenido = await texto(pdf);
      for (const esperado of esperados) assert.ok(contenido.includes(esperado), `${documento.archivo(datos)}: falta "${esperado}"`);
      assert.ok(await llevaImagen(pdf, datos.firma), "lleva la firma");
      assert.equal((await imagenes(pdf)).length, antes + (conSello ? 2 : 1), "firma y, si toca, sello");
    }
  });

  test("PHARMAMAR: la cabecera de la primera hoja con el nombre, el DNI, la empresa y la firma", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = { trabajador: resultado.trabajador, dni: resultado.dni, puesto: resultado.puesto, firma: resultado.firma, sello: SELLO, fecha: new Date(2026, 8, 21) };
    const especial = ESPECIALES.find((e) => e.id === "pharmamar");
    assert.equal(especial.archivo(datos), `DOCU ESPECIAL PHARMAMAR - ${resultado.trabajador}.pdf`);
    const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
    // La plantilla no puede traer datos de ningún trabajador anterior
    const original = await texto(plantilla, 0);
    for (const rastro of ["GARCIA BRICEÑO", "Z2952275T"]) assert.ok(!original.includes(rastro), `la plantilla está limpia de "${rastro}"`);
    const pdf = await generar(especial, plantilla, datos);
    assert.equal(await paginas(pdf), 17, "se entregan las 17 hojas");
    const textos = (await texto(pdf, 0)).split("\n").map((l) => l.trim());
    for (const esperado of [resultado.trabajador, resultado.dni, "TEMPS ETT MULTIWORK S.L."]) {
      assert.ok(textos.includes(esperado), `falta "${esperado}"`);
    }
    assert.ok(await llevaImagen(pdf, datos.firma, 0), "lleva la firma del trabajador");
    assert.equal(await llevaImagen(pdf, SELLO, 0), false, "este documento no lleva sello");
  });

  test("en los documentos especiales un nombre o puesto larguísimo no se sale de su hueco", async () => {
    const largo = "MARIA DEL CARMEN FERNANDEZ DE LA HOZ ECHEVARRIA GUTIERREZ";
    const puesto = "AYUDANTE DE COCINA Y MANTENIMIENTO DE INSTALACIONES DEPORTIVAS";
    const datos = { trabajador: largo, dni: "12345678Z", puesto, fecha: new Date(2027, 1, 28), firma: null };
    for (const especial of ESPECIALES.flatMap((e) => documentosDe(e).map((d) => ({ ...d, boton: e.boton })))) {
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));
      const pdf = await generar(especial, plantilla, datos);
      const indice = especial.pagina < 0 ? (await paginas(pdf)) + especial.pagina : especial.pagina;
      const todas = await lineas(pdf, indice);
      for (const campo of (especial.campos ?? []).filter((c) => c.valor && [largo, puesto].includes(c.valor(datos)))) {
        const [izquierda, derecha] = campo.centrado ? [campo.x - campo.ancho / 2, campo.x + campo.ancho / 2] : [campo.x, campo.x + campo.ancho];
        const alto = (campo.lineas ?? 1) * (campo.interlineado ?? campo.tamano * 1.2);
        // Las líneas de este campo: las que caen en su hueco y están formadas por palabras del texto
        const permitidas = new Set(campo.valor(datos).split(" "));
        const suyas = todas.filter((l) => l.bbox[1] > campo.y - campo.tamano - 2 && l.bbox[1] < campo.y + alto - campo.tamano &&
          l.bbox[0] >= izquierda - 0.5 && l.bbox[0] < derecha &&
          l.chars.map((c) => c.c).join("").trim().split(/\s+/).every((p) => permitidas.has(p)));
        const escrito = suyas.map((l) => l.chars.map((c) => c.c).join("").trim()).join(" ");
        assert.equal(escrito, campo.valor(datos), `${especial.boton}: el texto sale entero`);
        for (const l of suyas) assert.ok(l.bbox[2] <= derecha + 0.5, `${especial.boton}: acaba en ${l.bbox[2].toFixed(1)}, el hueco en ${derecha.toFixed(1)}`);
      }
    }
  });

  test("los botones van en orden: los dos estadios primero y el resto alfabético", () => {
    const botones = ordenados().map((e) => e.boton);
    assert.deepEqual(botones.slice(0, 2), ["REAL MADRID", "ATLETI"]);
    const resto = botones.slice(2);
    assert.deepEqual(resto, [...resto].sort((a, b) => a.localeCompare(b, "es")), "el resto, por orden alfabético");
    assert.equal(botones.length, ESPECIALES.length, "no se pierde ni se repite ningún botón");
  });

  test("documentos especiales nuevos: TALGO, MERCK, MONTESA, PLASTIPAK y TELEFONICA", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = {
      trabajador: resultado.trabajador,
      dni: resultado.dni,
      puesto: resultado.puesto,
      firma: resultado.firma,
      sello: SELLO,
      fecha: new Date(2026, 8, 22),
      apellidos: "PUCHOL VIÑA",
      nombre: "IGNACIO CARLOS",
    };
    // [id, índice del documento, nombre del archivo, páginas, textos que tienen que salir]
    const casos = [
      ["talgo", 0, `REGISTRO DE MEDIO AMBIENTE TALGO - ${resultado.trabajador}.pdf`, 4,
        [resultado.trabajador, resultado.puesto, "TALGO LAS MATAS II", "22/09/2026", "MADRID", "SEPTIEMBRE", "X"]],
      ["talgo", 1, `ACUSE RECIBO TALGO - ${resultado.trabajador}.pdf`, 1,
        [resultado.puesto, "PUCHOL VIÑA", "IGNACIO CARLOS", "22/09/2026", "MADRID", "X"]],
      ["merck-tres-cantos", 0, `DOCU ESPECIAL MERCK TRES CANTOS - ${resultado.trabajador}.pdf`, 4,
        [resultado.trabajador, "TEMPS MULTIWORK ETT", "22/09/2026"]],
      ["montesa-honda", 0, `DOCU ESPECIAL MONTESA HONDA - ${resultado.trabajador}.pdf`, 3,
        ["PUCHOL VIÑA, IGNACIO CARLOS", "TEMPS MULTIWORK SL ETT", "EUREST SERVICIOS", "22/09/2026"]],
      ["plastipak", 0, `DOCU ESPECIAL PLASTIPAK - ${resultado.trabajador}.pdf`, 1,
        [resultado.trabajador, "TEMPS MULTIWORK ETT", "22/09/2026"]],
      ["telefonica", 0, `DOCU ESPECIAL TELEFONICA - ${resultado.trabajador}.pdf`, 1,
        [resultado.trabajador, resultado.dni, resultado.puesto, "TEMPS MULTIWORK ETT", "SOLEDAD FERNANDEZ", "B01130186", "MADRID"]],
      // El CIF sale una sola vez (arriba, en su hueco); el DNI del trabajador, dos (tabla y pie)
    ];
    const cuentas = [
      ["telefonica", 0, "B01130186", 1],
      ["telefonica", 0, resultado.dni, 2],
    ];
    for (const [id, cual, archivo, numeroPaginas, esperados] of casos) {
      const documento = documentosDe(ESPECIALES.find((e) => e.id === id))[cual];
      assert.equal(documento.archivo(datos), archivo);
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${documento.plantilla}`, import.meta.url)));
      const pdf = await generar(documento, plantilla, datos);
      assert.equal(await paginas(pdf), numeroPaginas, `${archivo}: páginas`);
      const indice = documento.pagina < 0 ? numeroPaginas + documento.pagina : documento.pagina;
      const contenido = (await texto(pdf, indice)).replace(/\s+/g, " ");
      for (const esperado of esperados) assert.ok(contenido.includes(esperado), `${archivo}: falta "${esperado}"`);
      assert.ok(await llevaImagen(pdf, datos.firma, indice), `${archivo}: lleva la firma`);
    }

    // Cada dato tiene que salir las veces justas: el CIF de la empresa solo arriba, en su hueco,
    // y el DNI del trabajador en la tabla y en el bloque de abajo.
    for (const [id, cual, buscado, veces] of cuentas) {
      const documento = documentosDe(ESPECIALES.find((e) => e.id === id))[cual];
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${documento.plantilla}`, import.meta.url)));
      const contenido = (await texto(await generar(documento, plantilla, datos), 0)).replace(/\s+/g, " ");
      assert.equal(contenido.split(buscado).length - 1, veces, `"${buscado}" tiene que salir ${veces} vez/veces`);
    }
  });

  test("MACADAMIA: el nombre y el DNI van dentro de la frase, que se vuelve a justificar", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = { trabajador: resultado.trabajador, dni: resultado.dni, fecha: new Date(2026, 8, 23) };
    const especial = ESPECIALES.find((e) => e.id === "macadamia");
    assert.equal(especial.archivo(datos), `DOCU ESPECIAL MACADAMIA - ${resultado.trabajador}.pdf`);
    const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${especial.plantilla}`, import.meta.url)));

    // La plantilla se descarga desde el navegador, así que no puede llevar datos de nadie.
    const enBlanco = (await texto(plantilla)).replace(/\s+/g, "");
    assert.ok(!/JHON|JAIRO|CARVAJAL|VERGARA|Z3220161M/.test(enBlanco), "la plantilla no lleva el nombre del ejemplo");

    const pdf = await generar(especial, plantilla, datos);
    const contenido = (await texto(pdf)).replace(/\s+/g, "");
    assert.ok(contenido.includes(resultado.trabajador.replace(/\s+/g, "")), "sale el nombre del trabajador");
    assert.ok(contenido.includes(resultado.dni), "sale su DNI");
    assert.ok(contenido.includes("23.09.2026"), "sale la fecha del día");
    assert.ok(!contenido.includes("00000000A"), "no queda el DNI de relleno");

    // El párrafo tiene que seguir justificado entre los mismos márgenes que el documento original:
    // todas las líneas empiezan en el margen izquierdo y, menos la última, acaban en el derecho.
    const renglones = (await lineas(pdf)).filter((l) => /presente|evaluaci|Centro de Trabajo/.test(l.chars.map((c) => c.c).join("")));
    assert.ok(renglones.length >= 2, "el párrafo ocupa varias líneas");
    renglones.forEach((renglon, i) => {
      const letras = renglon.chars.filter((ch) => ch.glifo && ch.c.trim() !== "");
      const izquierda = letras[0].glifo.origen[0];
      const derecha = letras.at(-1).glifo.origen[0] + letras.at(-1).glifo.espaciado;
      assert.ok(Math.abs(izquierda - 72) < 0.5, `línea ${i + 1}: empieza en ${izquierda.toFixed(1)} y no en el margen`);
      if (i < renglones.length - 1) assert.ok(Math.abs(derecha - 523.5) < 1, `línea ${i + 1}: acaba en ${derecha.toFixed(1)} y no en el margen`);
    });
  });

  test("la firma y el sello no se salen de su casilla", async () => {
    const resultado = await procesar(leer(DOCS["51143385X"].archivo), {});
    const datos = { trabajador: resultado.trabajador, dni: resultado.dni, puesto: resultado.puesto, firma: resultado.firma, sello: SELLO, fecha: new Date(2026, 8, 22), apellidos: "PUCHOL VIÑA", nombre: "IGNACIO CARLOS" };
    for (const documento of ESPECIALES.flatMap((e) => documentosDe(e))) {
      const huecos = (documento.campos ?? []).filter((c) => c.imagen);
      if (!huecos.length) continue;
      const plantilla = new Uint8Array(fs.readFileSync(new URL(`../${documento.plantilla}`, import.meta.url)));
      const numeroPaginas = await paginas(plantilla);
      const indice = documento.pagina < 0 ? numeroPaginas + documento.pagina : documento.pagina;
      const antes = new Set((await imagenes(plantilla, indice)).map((im) => im.bbox.map(Math.round).join()));
      const pdf = await generar(documento, plantilla, datos);
      const nuevas = (await imagenes(pdf, indice)).filter((im) => !antes.has(im.bbox.map(Math.round).join()));
      // Cada imagen pegada tiene que caber entera dentro del hueco que le marca su campo: es lo
      // que evita que una firma se salga de su casilla y tape las rayas de la tabla.
      for (const im of nuevas) {
        const [x0, y0, x1, y1] = im.bbox;
        const cabe = huecos.some((c) => x0 >= c.x - 0.5 && x1 <= c.x + c.ancho + 0.5 && y0 >= c.y - 0.5 && y1 <= c.y + c.alto + 0.5);
        assert.ok(cabe, `${documento.plantilla}: la imagen ${im.bbox.map((v) => v.toFixed(1))} se sale de su hueco`);
      }
    }
  });

  test("las plantillas que traen el sello dentro llevan el sello nuevo", async () => {
    const sello = new Uint8Array(fs.readFileSync(new URL("../recursos/sello-temps.jpeg", import.meta.url)));
    const iguales = (a, b) => a && a.length === b.length && a.every((v, i) => v === b[i]);
    let encontrados = 0;
    for (const archivo of ["cepsa-anexo-24.pdf", "cun-madrid.pdf", "iese-madrid.pdf"]) {
      const bytes = new Uint8Array(fs.readFileSync(new URL(`../plantillas/${archivo}`, import.meta.url)));
      for (let n = 0; n < (await paginas(bytes)); n++) {
        for (const im of await imagenes(bytes, n)) {
          if (im.ancho !== 371 || im.alto !== 275) continue; // el sello, por su tamaño
          assert.ok(iguales(im.datos, sello), `${archivo}: el sello incrustado no es el nuevo`);
          encontrados++;
        }
      }
    }
    assert.equal(encontrados, 3, "las tres plantillas llevan su sello");
  });

  test("TA2: los datos del trabajador y la fecha de efectos del día", async () => {
    const plantilla = new Uint8Array(fs.readFileSync(new URL("../plantillas/ta2.pdf", import.meta.url)));
    const laboral = await abrirPdf(leer(DOCS["51143385X"].archivo));
    const { pdf, valores } = await generarTA2(plantilla, laboral, new Date(2027, 10, 15));
    assert.equal(valores.nombre, DOCS["51143385X"].nombre);
    assert.equal(valores.alta, "15/11/2027");
    const seguido = (await texto(pdf, 0)).replace(/\s+/g, " ");
    for (const esperado of [
      "D./Dña. IGNACIO CARLOS PUCHOL VIÑA, con fecha de nacimiento 10/03/1992,",
      "y DNI 051143385X, con fecha 15/11/2027, como trabajador de",
      "se indica a continuación: 15 de noviembre de 2027.",
    ]) {
      assert.ok(seguido.includes(esperado), `falta "${esperado}"`);
    }
    // Ni la fecha ni los datos de la plantilla pueden quedar en ningún sitio
    for (const viejo of ["19/09/2026", "19 de septiembre de 2026", "NOMBRE APELLIDOS", "000000000A"]) {
      assert.ok(!seguido.includes(viejo), `queda "${viejo}" de la plantilla`);
    }
    // Las casillas de la codificación informática se entregan en blanco
    assert.ok(/REFERENCIA: FECHA: HORA: HUELLA:/.test(seguido), "la codificación va vacía");
  });

  test("ITA: se lee la fecha, la cuenta y la hora a la que se sacó del Sistema RED", { skip: !existe(ITA) }, async () => {
    const ficha = await leerITA(leer(ITA), ITA);
    assert.equal(ficha.fecha, "2026-09-18");
    assert.equal(ficha.cuenta, "0111 37 107366063");
    assert.equal(ficha.id, "0111 37 107366063|2026-09-18");
    assert.equal(ficha.paginas, 34);
    assert.equal(ficha.cuantos, 837);
    // La hora sale de la codificación informática del pie, que es lo que distingue dos del mismo día
    assert.equal(ficha.emision, "2026-09-18T09:55:17");
    assert.equal(ficha.referencia, "A1172609000001");
    assert.equal(horaBonita(ficha.emision), "09:55");
    // El trabajador del DOCUMENTO GLOBAL tiene que estar, con su DNI a diez caracteres
    const cinthia = ficha.trabajadores.find((t) => t.documento === "0Y6912244E");
    assert.ok(cinthia, "CINTHIA sale en el ITA");
    assert.equal(cinthia.pagina, 15);
    assert.equal(cinthia.naf, "28 1548815306");
  });

  test("ITA: de dos del mismo día se queda el que se sacó más tarde", () => {
    const manana = { emision: "2026-09-18T09:55:17" };
    const tarde = { emision: "2026-09-18T13:40:02" };
    assert.equal(esMasNuevo(tarde, manana), true);
    assert.equal(esMasNuevo(manana, tarde), false);
    assert.equal(esMasNuevo(manana, manana), false, "el mismo no sustituye al mismo");
    // Si a alguno le falta la hora del informe, se compara con la hora en que se subió
    assert.equal(esMasNuevo({ guardado: "2026-09-18T20:00:00Z" }, { subido: "2026-09-18T08:00:00Z" }), true);
  });

  test("el NAF se escribe con los dos dígitos de la provincia separados", () => {
    assert.equal(nafFormateado("281548815306"), "28 1548815306");
    assert.equal(nafFormateado("28 1548815306"), "28 1548815306");
    assert.equal(nafFormateado("1548815306"), "00 1548815306", "se rellena con ceros si viene corto");
  });

  test("formato de la fecha de hoy", () => {
    assert.equal(fechaDeHoy(new Date(2026, 9, 5)), "5 de Octubre de 2026");
    assert.equal(fechaDeHoy(new Date(2027, 2, 17)), "17 de Marzo de 2027");
  });

  test("reescribir la misma fecha no cambia ni un píxel", async () => {
    const resultado = await procesar(leer(DOCS.Y6912244E.archivo), { sello: SELLO, fecha: FECHA_ORIGINAL });
    await resultado.originales();
    for (const hoja of resultado.hojas) {
      assert.notDeepEqual(hoja.pdf, hoja.pdfOriginal, "se ha reescrito de verdad");
      // Al dibujar, pdf.js puede redondear alguna posición: se admite 1-2 niveles (de 255), invisible
      const [nuevo, original] = [await pixeles(hoja.pdf), await pixeles(hoja.pdfOriginal)];
      assert.equal(nuevo.length, original.length, hoja.clave);
      let maximo = 0;
      for (let i = 0; i < nuevo.length; i++) maximo = Math.max(maximo, Math.abs(nuevo[i] - original[i]));
      assert.ok(maximo <= 2, `${hoja.clave}: diferencia de ${maximo} niveles`);
    }
  });

  test("cambia la fecha sin tocar el resto y vuelve a la original", async () => {
    const resultado = await procesar(leer(DOCS.Y6912244E.archivo), { sello: SELLO });
    const originales = resultado.hojas.map((h) => h.pdf);
    await resultado.originales();
    assert.deepEqual(await resultado.ponerFecha(DIFICIL), []);
    for (const hoja of resultado.hojas) {
      const nuevo = await texto(hoja.pdf);
      assert.ok(!nuevo.includes(FECHA_ORIGINAL), hoja.clave);
      assert.deepEqual(palabras(nuevo), palabras((await texto(hoja.pdfOriginal)).replace(FECHA_ORIGINAL, DIFICIL)), hoja.clave);
    }
    assert.ok((await texto(resultado.hojas[1].pdf)).includes(`${DIFICIL}.`), "EPI conserva el punto final");
    await resultado.ponerFecha(null);
    assert.deepEqual(resultado.hojas.map((h) => h.pdf), originales);
  });

  test("todos los meses y dígitos en los 4 documentos", async () => {
    for (const doc of Object.values(DOCS)) {
      const resultado = await procesar(leer(doc.archivo), { sello: SELLO });
      for (let mes = 0; mes < 12; mes++) {
        for (const dia of [1, 17, 28]) {
          const fecha = fechaDeHoy(new Date(2027 + (mes % 4), mes, dia));
          assert.deepEqual(await resultado.ponerFecha(fecha), [], `${doc.archivo} ${fecha}`);
          for (const hoja of resultado.hojas) assert.ok((await texto(hoja.pdf)).includes(fecha), `${doc.archivo} ${hoja.clave} ${fecha}`);
        }
      }
    }
  });
});
