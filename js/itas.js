// © 2026 Adrián Barroso de Cabo.
// Los ITA (informe de trabajadores en alta en un código de cuenta de cotización): guardarlos en el
// navegador y mirar si el trabajador del documento laboral cargado aparece en alguno.
//
// PARA QUÉ SIRVE
// Cada día se descarga del Sistema RED un ITA con toda la gente que está de alta. Cuando hay que
// mandarle a una empresa usuaria el justificante de que su trabajador está dado de alta, hay que
// buscarlo a mano en ese listado de decenas de páginas. Esto lo hace solo: al cargar el documento
// laboral, la web mira en los ITA guardados si está ese DNI/NIE y ofrece descargar el que lo lleva.
//
// DÓNDE SE GUARDAN
// En el propio navegador, en su almacén IndexedDB (aquí, la base "firmador-itas"). No se suben a
// ningún sitio: no salen del ordenador. Y no se borran al cerrar la web ni al apagar el ordenador;
// solo desaparecen si se borran los datos de navegación. Cada navegador y cada ordenador tiene los
// suyos, así que cada compañero mete los ITA en el suyo.
//
// CÓMO SE LEE EL DOCUMENTO
// El PDF del ITA es una tabla apaisada. Cada fila de trabajador está partida en trozos (el nombre,
// el NAF, el IPF…) porque las columnas van muy separadas, así que para reconstruir la fila se juntan
// todos los trozos que están a la misma altura de la página, ordenados de izquierda a derecha.
// De cada fila se guarda el nombre, el NAF, el DNI/NIE y en qué página está.
//
// SE BORRAN SOLOS
// Como cada día se descarga un ITA nuevo, los viejos se acumularían sin parar. Los que pasan de
// diez días (`DIAS_GUARDADOS`) se borran automáticamente al abrir la web y al guardar uno nuevo:
// con más de siete ya no valen para mandarlos a una empresa usuaria.
//
// LA FECHA Y LOS 7 DÍAS
// La fecha del informe se lee de su cabecera ("INFORME DE TRABAJADORES EN ALTA A FECHA: 18 09 2026").
// Las empresas usuarias no suelen aceptar un ITA de más de 7 días, así que `diasDesde` permite
// avisar cuando el que se va a descargar ya se ha quedado viejo.

import { interpretar, lineasDeGlifos } from "./lector.js";
import { abrirPdf } from "./pdfbase.js";

// Una fila de trabajador: nombre, NAF (2 + 10 cifras), tipo de documento, DNI/NIE y fecha de alta.
const FILA = /^(?<nombre>[^\d]{3,}?)\s+(?<naf>\d{2} \d{10})\s+\d\s+(?<documento>[0-9A-Z]{9,10})\s+(?<alta>\d{2}) (?<altaMes>\d{2}) (?<altaAno>\d{4})/;
const FECHA_INFORME = /A FECHA:\s*(\d{2})\s+(\d{2})\s+(\d{4})/;
const CUENTA = /CUENTA COTIZACIÓN:\s*(\d{4} \d{2} \d{9})/;
const TITULO = "INFORME DE TRABAJADORES EN ALTA";

/** A partir de cuántos días un ITA se considera viejo para mandarlo a una empresa usuaria. */
export const DIAS_VALIDO = 7;

/**
 * Cuántos días se guarda un ITA antes de borrarse solo. Pasada esa fecha ya no sirve para mandarlo
 * a nadie, así que no tiene sentido tenerlo ocupando sitio en el navegador.
 */
export const DIAS_GUARDADOS = 10;

export class ITANoLeido extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ITANoLeido";
  }
}

// ------------------------------------------------------------------ leer el PDF

/**
 * Lee un ITA y devuelve lo que hace falta guardar de él: la fecha, la cuenta de cotización y la
 * lista de trabajadores con su página. Los bytes del PDF se guardan aparte, tal cual.
 */
export async function leerITA(bytes, archivo = "") {
  const doc = await abrirPdf(bytes);
  const paginas = doc.getPages();
  let fecha = null;
  let cuenta = null;
  const trabajadores = [];

  paginas.forEach((pagina, i) => {
    for (const texto of filasDePagina(doc, pagina)) {
      // La cabecera se repite en todas las páginas: basta con la primera vez que se encuentra.
      if (!fecha) {
        const encontrada = FECHA_INFORME.exec(texto);
        if (encontrada) fecha = `${encontrada[3]}-${encontrada[2]}-${encontrada[1]}`; // aaaa-mm-dd, para ordenar
      }
      if (!cuenta) {
        const encontrada = CUENTA.exec(texto);
        if (encontrada) cuenta = encontrada[1];
      }
      const fila = FILA.exec(texto);
      if (!fila) continue;
      trabajadores.push({
        nombre: fila.groups.nombre.trim(),
        naf: fila.groups.naf,
        documento: normalizarDocumento(fila.groups.documento),
        alta: `${fila.groups.altaAno}-${fila.groups.altaMes}-${fila.groups.alta}`,
        pagina: i + 1,
      });
    }
  });

  if (!fecha || !trabajadores.length) throw new ITANoLeido("el PDF no parece un ITA (informe de trabajadores en alta).");
  return {
    id: `${cuenta ?? "sin-cuenta"}|${fecha}`, // dos ITA de la misma cuenta y fecha son el mismo: se sustituye
    archivo,
    fecha,
    cuenta,
    paginas: paginas.length,
    trabajadores,
    guardado: new Date().toISOString(),
    tamano: bytes.length,
  };
}

/**
 * Las filas de texto de una página: los trozos que están a la misma altura se juntan en una sola
 * línea, ordenados de izquierda a derecha. Es lo que permite leer una tabla de columnas separadas.
 */
function filasDePagina(doc, pagina) {
  const lineas = lineasDeGlifos(interpretar(doc, pagina).glifos);
  const porAltura = new Map();
  for (const linea of lineas) {
    const primera = linea.chars.find((ch) => ch.glifo);
    if (!primera) continue;
    // Se redondea a medio punto para que dos trozos de la misma fila caigan en el mismo grupo.
    const altura = Math.round(primera.glifo.origen[1] * 2) / 2;
    if (!porAltura.has(altura)) porAltura.set(altura, []);
    porAltura.get(altura).push({ x: primera.glifo.origen[0], texto: linea.chars.map((ch) => ch.c).join("").trim() });
  }
  return [...porAltura.values()].map((trozos) =>
    trozos.sort((a, b) => a.x - b.x).map((t) => t.texto).filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

/** ¿Este PDF es un ITA? Se mira solo la primera página, para poder decidirlo al vuelo. */
export async function esITA(bytes) {
  try {
    const doc = await abrirPdf(bytes);
    if (!doc.getPageCount()) return false;
    return filasDePagina(doc, doc.getPage(0)).some((texto) => texto.includes(TITULO));
  } catch {
    return false;
  }
}

/** El DNI/NIE siempre con 10 caracteres y en mayúsculas, que es como lo escribe el ITA. */
export function normalizarDocumento(documento) {
  return (documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().padStart(10, "0");
}

/** Días transcurridos desde la fecha del informe (en formato aaaa-mm-dd) hasta hoy. */
export function diasDesde(fecha, hoy = new Date()) {
  const [ano, mes, dia] = fecha.split("-").map(Number);
  const informe = new Date(ano, mes - 1, dia);
  const sinHoras = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((sinHoras - informe) / 86400000);
}

/** La fecha del informe tal y como se enseña: "18/09/2026". */
export function fechaBonita(fecha) {
  const [ano, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ------------------------------------------------------------------ almacén del navegador

const BASE = "firmador-itas";
const FICHAS = "itas"; // los datos de cada ITA (fecha, cuenta, trabajadores…)
const PDFS = "pdfs"; // los bytes del PDF, aparte, para que listar sea rápido

let conexion = null;

function abrirBase() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => {
      const base = peticion.result;
      if (!base.objectStoreNames.contains(FICHAS)) base.createObjectStore(FICHAS, { keyPath: "id" });
      if (!base.objectStoreNames.contains(PDFS)) base.createObjectStore(PDFS);
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error ?? new Error("no se puede abrir el almacén del navegador"));
  });
  return conexion;
}

/** Envuelve una operación de IndexedDB en una promesa, que es más cómodo de usar. */
function operacion(almacenes, modo, trabajo) {
  return abrirBase().then((base) => new Promise((resolver, rechazar) => {
    const transaccion = base.transaction(almacenes, modo);
    let resultado;
    transaccion.oncomplete = () => resolver(resultado);
    transaccion.onerror = () => rechazar(transaccion.error);
    transaccion.onabort = () => rechazar(transaccion.error);
    const pedir = (peticion) => new Promise((ok, mal) => {
      peticion.onsuccess = () => ok(peticion.result);
      peticion.onerror = () => mal(peticion.error);
    });
    Promise.resolve(trabajo(transaccion, pedir)).then((valor) => { resultado = valor; }, rechazar);
  }));
}

/** Guarda (o sustituye) un ITA con sus bytes. */
export async function guardarITA(ficha, bytes) {
  await operacion([FICHAS, PDFS], "readwrite", (transaccion, pedir) => Promise.all([
    pedir(transaccion.objectStore(FICHAS).put(ficha)),
    pedir(transaccion.objectStore(PDFS).put(new Blob([bytes], { type: "application/pdf" }), ficha.id)),
  ]));
  return ficha;
}

/** Los ITA guardados, del más reciente al más antiguo (sin los bytes de los PDF). */
export async function listarITAs() {
  const fichas = await operacion([FICHAS], "readonly", (transaccion, pedir) => pedir(transaccion.objectStore(FICHAS).getAll()));
  return fichas.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Los bytes del PDF de un ITA guardado. */
export async function pdfDeITA(id) {
  const blob = await operacion([PDFS], "readonly", (transaccion, pedir) => pedir(transaccion.objectStore(PDFS).get(id)));
  if (!blob) throw new ITANoLeido("ese ITA ya no está guardado.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Quita un ITA del almacén. */
export async function borrarITA(id) {
  await operacion([FICHAS, PDFS], "readwrite", (transaccion, pedir) => Promise.all([
    pedir(transaccion.objectStore(FICHAS).delete(id)),
    pedir(transaccion.objectStore(PDFS).delete(id)),
  ]));
}

/**
 * Borra los ITA de más de `DIAS_GUARDADOS` días. Devuelve cuántos ha quitado, para poder avisar.
 * Se llama al abrir la web y cada vez que se guarda un ITA nuevo.
 */
export async function limpiarAntiguos(hoy = new Date()) {
  const viejos = (await listarITAs()).filter((ficha) => diasDesde(ficha.fecha, hoy) > DIAS_GUARDADOS);
  for (const ficha of viejos) await borrarITA(ficha.id);
  return viejos.length;
}

/**
 * Busca un DNI/NIE en los ITA guardados. Devuelve una entrada por cada ITA en el que aparezca,
 * ORDENADAS DE LA MÁS RECIENTE A LA MÁS ANTIGUA (la lista ya viene ordenada por fecha), así que la
 * primera es siempre la que hay que ofrecer para descargar.
 */
export async function buscarTrabajador(documento, fichas = null) {
  const buscado = normalizarDocumento(documento);
  if (!buscado || buscado === "0000000000") return [];
  const lista = fichas ?? (await listarITAs());
  const encontrados = [];
  for (const ficha of lista) {
    const trabajador = ficha.trabajadores.find((t) => t.documento === buscado);
    if (trabajador) encontrados.push({ ita: ficha, trabajador, dias: diasDesde(ficha.fecha) });
  }
  return encontrados;
}
