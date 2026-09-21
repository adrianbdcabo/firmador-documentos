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
// DÓNDE SE GUARDAN: HAY DOS SITIOS
// 1) LA CARPETA COMPARTIDA. En la web de Cloudflare hay un servidor (worker/index.js) con una base
//    de datos en Europa. Los ITA que sube cualquiera los ven todos: el que sube el del día por la
//    mañana se lo ahorra a los demás. Es lo que se usa siempre que está disponible.
// 2) EL ALMACÉN DEL NAVEGADOR (IndexedDB, la base "firmador-itas"). Es el de antes: los ITA no
//    salen del ordenador y cada compañero tiene los suyos. Se usa de respaldo, cuando la web se
//    abre en un sitio sin servidor (la copia de GitHub) o si el servidor no contesta.
// `dondeSeGuardan()` dice cuál de los dos se está usando, para poder contarlo en la pantalla.
//
// CUÁL SE QUEDA SI HAY DOS DEL MISMO DÍA
// Un ITA se identifica por su cuenta de cotización y su fecha. Si llega otro del mismo día se
// queda el que se sacó MÁS TARDE del Sistema RED, porque durante la jornada se dan altas nuevas y
// el de las 13:40 trae gente que el de las 09:55 todavía no tenía. La hora de extracción la trae
// el propio informe en el pie ("CODIFICACIONES INFORMÁTICAS ... FECHA: 18-09-2026 HORA: 09:55:17").
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
// El pie de cada página: "REFERENCIA: A1172609000001  FECHA: 18-09-2026  HORA: 09:55:17  HUELLA: …".
// Esa fecha y esa hora son el momento exacto en que se sacó el informe del Sistema RED. Entre el
// rótulo y el valor el PDF mete un carácter suelto que no se puede leer, de ahí el "\S?".
const EMISION = /FECHA:\s*\S?\s*(?<dia>\d{2})-(?<mes>\d{2})-(?<ano>\d{4})\s+HORA:\s*\S?\s*(?<hora>\d{2}:\d{2}:\d{2})/;
// La referencia solo sale entera en la última página; en las demás aparece el rótulo sin su valor.
const REFERENCIA = /REFERENCIA:\s*([A-Z]\d{6,})/;
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
  let referencia = null;
  let emision = null; // cuándo se sacó del Sistema RED
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
      if (!emision) {
        const g = EMISION.exec(texto)?.groups;
        if (g) emision = `${g.ano}-${g.mes}-${g.dia}T${g.hora}`; // aaaa-mm-ddThh:mm:ss, para comparar
      }
      if (!referencia) {
        const encontrada = REFERENCIA.exec(texto);
        if (encontrada) referencia = encontrada[1];
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
    id: `${cuenta ?? "sin-cuenta"}|${fecha}`, // dos ITA de la misma cuenta y fecha son el mismo
    archivo,
    fecha,
    cuenta,
    referencia,
    emision,
    paginas: paginas.length,
    trabajadores,
    cuantos: trabajadores.length, // el número suelto, que es lo que se enseña en las listas
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


// ------------------------------------------------------------------ cuál se queda de dos del mismo día

/**
 * ¿El ITA que acaba de llegar es más nuevo que el que ya había? Se compara la hora a la que se
 * sacó del Sistema RED, que es la que trae el propio informe en el pie. Si a alguno le falta (un
 * PDF raro, o uno guardado antes de que la web leyera ese dato), se usa la hora en que se subió,
 * que es lo más parecido que hay.
 */
export function esMasNuevo(nueva, vieja) {
  const cuando = (ficha) => ficha?.emision ?? ficha?.guardado ?? ficha?.subido ?? "";
  return cuando(nueva) > cuando(vieja);
}

/** La hora de extracción tal y como se enseña: "09:55". Vacío si el informe no la trae. */
export function horaBonita(emision) {
  return emision ? emision.slice(11, 16) : "";
}

// ------------------------------------------------------------------ el almacén del navegador

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

/**
 * El almacén de toda la vida: dentro de este navegador. Lo que se guarda aquí no sale del
 * ordenador y solo lo ve quien lo subió.
 */
const ALMACEN_LOCAL = {
  compartido: false,
  puedeBorrar: true, // cada uno manda en lo suyo
  donde: "este navegador",

  async listar() {
    const fichas = await operacion([FICHAS], "readonly", (t, pedir) => pedir(t.objectStore(FICHAS).getAll()));
    return fichas
      .map((ficha) => ({ ...ficha, cuantos: ficha.cuantos ?? ficha.trabajadores?.length ?? 0 }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  },

  async guardar(ficha, bytes) {
    // Si ya hay uno de la misma cuenta y día, se queda el que se sacó más tarde del Sistema RED.
    const anterior = (await this.listar()).find((f) => f.id === ficha.id);
    if (anterior && !esMasNuevo(ficha, anterior)) return { guardado: false, motivo: "hay-uno-mas-nuevo", anterior };
    await operacion([FICHAS, PDFS], "readwrite", (t, pedir) => Promise.all([
      pedir(t.objectStore(FICHAS).put(ficha)),
      pedir(t.objectStore(PDFS).put(new Blob([bytes], { type: "application/pdf" }), ficha.id)),
    ]));
    return { guardado: true, sustituido: Boolean(anterior) };
  },

  async pdf(id) {
    const blob = await operacion([PDFS], "readonly", (t, pedir) => pedir(t.objectStore(PDFS).get(id)));
    if (!blob) throw new ITANoLeido("ese ITA ya no está guardado.");
    return new Uint8Array(await blob.arrayBuffer());
  },

  async borrar(id) {
    await operacion([FICHAS, PDFS], "readwrite", (t, pedir) => Promise.all([
      pedir(t.objectStore(FICHAS).delete(id)),
      pedir(t.objectStore(PDFS).delete(id)),
    ]));
  },

  async limpiar(hoy = new Date()) {
    const viejos = (await this.listar()).filter((ficha) => diasDesde(ficha.fecha, hoy) > DIAS_GUARDADOS);
    for (const ficha of viejos) await this.borrar(ficha.id);
    return viejos.length;
  },

  /** Aquí la lista de trabajadores viene dentro de cada ficha, así que se busca en memoria. */
  async buscar(documento, fichas = null) {
    const buscado = normalizarDocumento(documento);
    if (!buscado || buscado === "0000000000") return [];
    const lista = fichas ?? (await this.listar());
    const encontrados = [];
    for (const ficha of lista) {
      const trabajador = ficha.trabajadores?.find?.((t) => t.documento === buscado);
      if (trabajador) encontrados.push({ ita: ficha, trabajador, dias: diasDesde(ficha.fecha) });
    }
    return encontrados;
  },
};

// ------------------------------------------------------------------ la carpeta compartida

// La carpeta de la web: este archivo es <web>/js/itas.js, así que subiendo uno se llega a <web>/.
// Las direcciones del servidor van relativas a ella, para que funcione igual en la web de
// Cloudflare (que cuelga de la raíz) que en la de GitHub (que cuelga de /firmador-documentos/).
const RAIZ = new URL("../", import.meta.url);

/** Llama al servidor y devuelve su respuesta, con un error en condiciones si algo va mal. */
async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(new URL(ruta, RAIZ), { cache: "no-store", ...opciones });
  if (!respuesta.ok) {
    const datos = await respuesta.json().catch(() => null);
    throw new ITANoLeido(datos?.error ?? `el servidor de ITA ha contestado ${respuesta.status}.`);
  }
  return respuesta;
}

/** El almacén de Cloudflare: una carpeta de ITA que comparten todos los que entran en la web. */
function almacenCompartido(puedeBorrar) {
  return {
    compartido: true,
    puedeBorrar,
    donde: "la carpeta compartida",

    async listar() {
      return (await (await pedir("api/itas")).json()).itas ?? [];
    },

    async guardar(ficha, bytes) {
      const respuesta = await pedir("api/itas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ficha, pdf: aBase64(bytes) }),
      });
      const datos = await respuesta.json();
      return datos.guardado ? datos : { ...datos, anterior: { emision: datos.emision, subido: datos.subido } };
    },

    async pdf(id) {
      const respuesta = await pedir(`api/itas/${encodeURIComponent(id)}/pdf`);
      return new Uint8Array(await respuesta.arrayBuffer());
    },

    async borrar(id) {
      await pedir(`api/itas/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    /** La limpieza de los de más de diez días la hace el servidor él solo, cada madrugada. */
    async limpiar() {
      return 0;
    },

    /** Aquí busca el servidor: una consulta con índice, por muchos ITA que haya guardados. */
    async buscar(documento) {
      const buscado = normalizarDocumento(documento);
      if (!buscado || buscado === "0000000000") return [];
      const datos = await (await pedir(`api/itas/buscar?documento=${encodeURIComponent(buscado)}`)).json();
      return (datos.encontrados ?? []).map((e) => ({ ...e, dias: diasDesde(e.ita.fecha) }));
    },
  };
}

/** Los bytes de un PDF en texto base64, por trozos para no agotar la pila con archivos grandes. */
function aBase64(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 8192) binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binario);
}

// ------------------------------------------------------------------ elegir almacén y usarlo

let elegido = null;

/**
 * Decide, una sola vez al arrancar, dónde se guardan los ITA: si la web tiene servidor detrás
 * (la de Cloudflare) se usa la carpeta compartida; si no (la copia de GitHub, o si el servidor no
 * contesta), el almacén de este navegador.
 */
export function almacen() {
  if (!elegido) {
    elegido = (async () => {
      try {
        const datos = await (await pedir("api/itas")).json();
        if (datos?.almacen === "compartido") return almacenCompartido(Boolean(datos.puedeBorrar));
      } catch {
        // Sin servidor: se sigue con el almacén del navegador, como siempre.
      }
      return ALMACEN_LOCAL;
    })();
  }
  return elegido;
}

/** Dónde se están guardando los ITA ahora mismo, para poder contarlo en la pantalla. */
export async function dondeSeGuardan() {
  const donde = await almacen();
  return { compartido: donde.compartido, puedeBorrar: donde.puedeBorrar, donde: donde.donde };
}

/**
 * Guarda (o sustituye) un ITA. Devuelve `{ guardado: true }` o, si ya había uno de ese mismo día
 * sacado más tarde, `{ guardado: false, motivo: "hay-uno-mas-nuevo", anterior }`.
 */
export async function guardarITA(ficha, bytes) {
  return (await almacen()).guardar(ficha, bytes);
}

/** Los ITA guardados, del más reciente al más antiguo (sin los bytes de los PDF). */
export async function listarITAs() {
  return (await almacen()).listar();
}

/** Los bytes del PDF de un ITA guardado. */
export async function pdfDeITA(id) {
  return (await almacen()).pdf(id);
}

/** Quita un ITA. En la carpeta compartida solo pueden los correos autorizados. */
export async function borrarITA(id) {
  return (await almacen()).borrar(id);
}

/**
 * Borra los ITA de más de `DIAS_GUARDADOS` días. En el navegador se hace aquí; en la carpeta
 * compartida lo hace el servidor solo cada madrugada, así que no hay nada que limpiar.
 */
export async function limpiarAntiguos(hoy = new Date()) {
  return (await almacen()).limpiar(hoy);
}

/**
 * Busca un DNI/NIE en los ITA guardados. Devuelve una entrada por cada ITA en el que aparezca,
 * ORDENADAS DE LA MÁS RECIENTE A LA MÁS ANTIGUA, así que la primera es siempre la que hay que
 * ofrecer para descargar.
 */
export async function buscarTrabajador(documento, fichas = null) {
  return (await almacen()).buscar(documento, fichas);
}
