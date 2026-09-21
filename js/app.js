// © 2026 Adrián Barroso de Cabo.
// Interfaz: cargar el documento laboral (y, si hace falta, la firma y el sello), previsualizar y descargar.

import { documentosDe, ESPECIALES, generar } from "./especiales.js";
import { fechaDeHoy } from "./fecha.js";
import * as firmas from "./firma.js";
import { abrirCacheado, calentar, ErrorProcesado, FirmaNoEncontrada, procesar } from "./pdf.js";
import * as itas from "./itas.js";
import { miniatura, miniaturas } from "./render.js";
import { generarTA2 } from "./ta2.js";

const $ = (id) => document.getElementById(id);
const RUTA_SELLO = "recursos/sello-temps.jpeg"; // el sello viene con la web: no hay que cargarlo
const RUTA_TA2 = "plantillas/ta2.pdf"; // informe de alta en blanco que se rellena con los datos del trabajador
const RUTA_CALENTAR = "plantillas/real-madrid.pdf"; // PDF pequeño con el que se pone a punto el motor al abrir
const DESFASE_PACK = 0.13; // parte de cada hoja de detrás que asoma en la vista del pack
const ANCHO_MAX_PACK = 380;
const RESERVA_ETIQUETAS_PACK = 80; // hueco a la derecha de la pila para "INFO · página 1"

// En móviles y tabletas no hay arrastrar, Ctrl+V ni "pasar el ratón": los textos cambian.
const TACTIL = matchMedia("(hover: none) and (pointer: coarse)").matches;
const TEXTOS = TACTIL
  ? {
      zonaTitulo: "Toca aquí para cargar el documento laboral",
      zonaSubtitulo: "o usa «Cargar documentos laborales»",
      pedirFirma: "Pulsa «Cargar firma» y elige un PDF firmado o una captura de la firma",
      sinFirma: "Firma: la del documento, o pulsa «Cargar firma»",
      listo: "Listo. Pulsa Descargar, o toca una hoja para descargar solo esa.",
    }
  : {
      zonaTitulo: "Arrastra aquí el documento laboral",
      zonaSubtitulo: "o pulsa «Cargar documentos laborales»",
      pedirFirma: "Pulsa «Cargar firma» (PDF firmado o captura) o pega una captura con Ctrl+V",
      sinFirma: "Firma: la del documento, o pulsa «Cargar firma» / pega una captura con Ctrl+V",
      listo: "Listo. Pulsa Descargar, o pincha en una hoja para descargar solo esa.",
    };

const estado = {
  documento: null, // { nombre, datos } del documento laboral cargado
  firma: null, // firma cargada aparte; si no hay, se usa la del documento
  resultado: null,
  sello: null, // imagen del sello de la empresa, que se descarga con la web
  modo: "separados",
  itas: [], // fichas de los ITA guardados en este navegador (sin los PDF)
  enITA: null, // dónde aparece el trabajador de ahora: { ita, trabajador, dias }
  urls: new Map(), // miniaturas ya generadas (bytes de las hojas -> ancho -> URLs)
  imagenes: new WeakMap(), // resultado -> la firma y el sello listos para dibujarlos encima
};

// Documento laboral

async function cargarDocumento(archivo) {
  const datos = new Uint8Array(await archivo.arrayBuffer());

  // Si lo que se carga es un ITA (el listado de trabajadores en alta), no se procesa: se guarda
  // para poder buscar trabajadores en él. Así vale con arrastrarlo, sin botones aparte.
  if (await itas.esITA(datos)) {
    await anadirITA(datos, archivo.name);
    return;
  }

  // Si lo que se carga es una hoja suelta ya firmada (INFO, EPI o REN), se usa como firma.
  let hojaFirmada = null;
  try {
    hojaFirmada = await firmas.deHojaSuelta(datos, archivo.name);
  } catch {
    hojaFirmada = null; // no es un PDF válido: que lo diga el procesado normal
  }
  if (hojaFirmada) {
    await usarFirma(() => hojaFirmada);
    return;
  }

  if (estado.firma?.usada) estado.firma = null; // ya sirvió para el anterior, normalmente de otro trabajador
  // Cada documento empieza con la fecha de hoy y el sello; el usuario puede quitarlos
  $("fecha-hoy").checked = true;
  $("con-sello").checked = true;
  try {
    await cargarSello();
  } catch {
    $("con-sello").checked = false; // sin conexión para bajar el sello: se sigue sin él
  }
  estado.documento = { nombre: archivo.name, datos };
  await procesarDocumento();
}

/**
 * Genera las hojas del documento cargado.
 * Con `mantenerVista` no se vacía la pantalla mientras se rehacen (al añadir el sello o cambiar
 * la firma), para que no haya parpadeo: lo anterior sigue a la vista hasta que lo nuevo está listo.
 */
async function procesarDocumento({ mantenerVista = false } = {}) {
  const { nombre, datos } = estado.documento;
  if (!mantenerVista) limpiar();
  $("archivo").textContent = nombre;
  ponerEstado(mantenerVista ? "Actualizando…" : "Procesando…");
  await pausa();

  let resultado;
  try {
    const sello = $("con-sello").checked ? estado.sello : null;
    resultado = await procesar(datos, { fecha: fechaElegida(), imagenFirma: estado.firma?.imagen, sello });
  } catch (error) {
    if (mantenerVista) limpiar();
    if (error instanceof FirmaNoEncontrada) {
      pedirFirma();
      return;
    }
    estado.documento = null;
    ponerEstado("No se ha podido procesar el documento.");
    await alerta("No se ha podido procesar", error instanceof ErrorProcesado ? error.message : `Ha ocurrido un error inesperado:\n${error}`);
    return;
  }

  // Solo se pregunta la primera vez que se aplica la firma, no al volver a generar las hojas (p. ej. al añadir el sello).
  if (estado.firma && !estado.firma.usada && !estado.firma.esDe(resultado.dni)) {
    const usar = await confirmar(
      "La firma es de otra persona",
      `La firma cargada es de ${estado.firma.nombre} (NIF ${estado.firma.nif}), pero el documento es de ${resultado.trabajador} (DNI ${resultado.dni}).\n\n¿Quieres usar esta firma igualmente?`,
      "Usar igualmente",
    );
    if (!usar) {
      estado.firma = null;
      await procesarDocumento({ mantenerVista });
      return;
    }
  }
  if (estado.firma) estado.firma.usada = true;

  estado.resultado = resultado;
  $("interruptor-sello").hidden = false;
  $("especiales").hidden = false;
  await mostrarPrevias();
  $("btn-descargar").disabled = false;
  $("btn-ta2").disabled = false;
  ponerEstado(TEXTOS.listo);
  buscarEnITAs(resultado.dni).catch(() => {}); // no debe estorbar si falla el almacén
  await avisarFecha();
}

function limpiar() {
  estado.resultado = null;
  for (const porAncho of estado.urls.values()) for (const urls of porAncho.values()) urls.forEach((url) => URL.revokeObjectURL(url));
  estado.urls.clear();
  $("tarjetas").hidden = true;
  $("tarjetas").replaceChildren();
  $("pila").hidden = true;
  $("pila").replaceChildren();
  mostrarZona(TEXTOS.zonaTitulo, TEXTOS.zonaSubtitulo, () => $("input-documento").click());
  $("interruptor-sello").hidden = true; // aparecen una vez generadas las hojas
  $("especiales").hidden = true;
  $("btn-descargar").disabled = true;
  $("btn-ta2").disabled = true;
  estado.enITA = null;
  $("fila-ita").hidden = true;
  actualizarDatos();
  ponerEstado("");
}

function mostrarZona(titulo, subtitulo, accion) {
  $("zona-titulo").textContent = titulo;
  $("zona-subtitulo").textContent = subtitulo;
  $("zona").onclick = accion;
  $("zona").hidden = false;
}

function pedirFirma() {
  ponerEstado("Este documento no está firmado: carga la firma y se aplicará automáticamente.");
  mostrarZona("Este documento no está firmado", TEXTOS.pedirFirma, () => $("input-firma").click());
}

const esperandoFirma = () => estado.documento && !estado.resultado;

// Firma

async function cargarFirmaArchivo(archivo) {
  const datos = new Uint8Array(await archivo.arrayBuffer());
  const esPdf = archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
  await usarFirma(() => (esPdf ? firmas.desdePdf(datos, archivo.name) : firmas.desdeImagen(datos, archivo.name)));
}

async function usarFirma(obtener) {
  ponerEstado("Leyendo la firma…");
  await pausa();
  let firma;
  try {
    firma = await obtener();
  } catch (error) {
    ponerEstado("");
    await alerta("No se ha podido cargar la firma", error instanceof ErrorProcesado ? error.message : `Ha ocurrido un error inesperado:\n${error}`);
    return;
  }
  estado.firma = firma;
  if (estado.documento) {
    await procesarDocumento({ mantenerVista: true }); // se aplica al documento que ya está cargado
  } else {
    actualizarDatos();
    ponerEstado("Firma cargada. Ahora carga el documento laboral.");
  }
}

async function quitarFirma() {
  estado.firma = null;
  if (estado.documento) await procesarDocumento({ mantenerVista: true });
  else {
    actualizarDatos();
    ponerEstado("");
  }
}

// Sello

async function cargarSello() {
  if (!estado.sello) {
    const respuesta = await fetch(new URL(RUTA_SELLO, location.href));
    if (!respuesta.ok) throw new Error(`no se ha podido cargar el sello (${respuesta.status})`);
    estado.sello = new Uint8Array(await respuesta.arrayBuffer());
  }
  return estado.sello;
}

async function cambiarSello() {
  if ($("con-sello").checked && !estado.sello) {
    try {
      await cargarSello();
    } catch (error) {
      $("con-sello").checked = false;
      await alerta("No se ha podido añadir el sello", error.message);
      return;
    }
  }
  if (estado.documento) await procesarDocumento({ mantenerVista: true });
}

// Fecha

const fechaElegida = () => ($("fecha-hoy").checked ? fechaDeHoy() : null);

async function cambiarFecha() {
  if (!estado.resultado) {
    actualizarDatos(); // se aplicará al cargar el documento
    return;
  }
  ponerEstado("Cambiando la fecha…");
  await pausa();
  try {
    await estado.resultado.ponerFecha(fechaElegida());
  } catch (error) {
    await estado.resultado.ponerFecha(null);
    $("fecha-hoy").checked = false;
    await alerta("Error inesperado", `No se ha podido cambiar la fecha:\n${error}`);
  }
  await mostrarPrevias();
  ponerEstado(TEXTOS.listo);
  await avisarFecha();
}

async function avisarFecha() {
  if (estado.resultado?.avisos.length) {
    await alerta("Fecha no cambiada", `No se ha podido poner la fecha de hoy en estas hojas, que se quedan con la original:\n\n${estado.resultado.avisos.join("\n")}`);
  }
}

function actualizarDatos() {
  const { resultado, firma } = estado;
  $("trabajador").textContent = resultado?.trabajador ?? "";
  if (!resultado) $("fecha").textContent = $("fecha-hoy").checked ? `Se pondrá la fecha de hoy: ${fechaDeHoy()}` : "";
  else $("fecha").textContent = resultado.fecha ? `Fecha de hoy · ${resultado.fecha}` : "Fecha original del documento";

  const img = $("img-firma");
  const texto = $("texto-firma");
  if (firma) {
    if (img.dataset.origen !== String(firmaId(firma))) {
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(new Blob([firma.imagen], { type: "image/png" }));
      img.dataset.origen = String(firmaId(firma));
    }
    img.hidden = false;
    texto.textContent = `Firma cargada: ${firma.origen}${firma.nombre ? ` · ${firma.nombre}` : ""}`;
    texto.className = "pequeno texto-cargada";
    $("quitar-firma").hidden = false;
  } else {
    img.hidden = true;
    texto.textContent = resultado ? "Firma: la del propio documento" : TEXTOS.sinFirma;
    texto.className = "pequeno suave";
    $("quitar-firma").hidden = true;
  }
}

const ids = new WeakMap();
let siguienteId = 1;
function firmaId(firma) {
  if (!ids.has(firma)) ids.set(firma, siguienteId++);
  return ids.get(firma);
}

// Vistas previas

/**
 * URLs de las vistas previas de las tres hojas. Se dibujan las tres juntas (comparten fuentes) sin
 * la firma ni el sello, y esas dos imágenes se pegan encima: así es bastante más rápido.
 */
async function urlsMiniaturas(resultado, ancho) {
  const pdf = resultado.desnudo;
  let porPdf = estado.urls.get(pdf);
  if (!porPdf) {
    porPdf = new Map();
    estado.urls.set(pdf, porPdf);
  }
  if (!porPdf.has(ancho)) {
    const imagenes = await miniaturas(pdf, ancho, await sitiosConImagen(resultado));
    porPdf.set(ancho, imagenes.map((bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/bmp" }))));
  }
  return porPdf.get(ancho);
}

/** La firma y el sello de cada hoja, listos para dibujarlos encima de la vista previa. */
async function sitiosConImagen(resultado) {
  if (!estado.imagenes.has(resultado)) {
    const aImagen = async (bytes) => createImageBitmap(new Blob([bytes]));
    estado.imagenes.set(resultado, {
      firma: await aImagen(resultado.firma),
      sello: resultado.sello ? await aImagen(resultado.sello) : null,
    });
  }
  const { firma, sello } = estado.imagenes.get(resultado);
  return resultado.sitios.map((sitios) => sitios.map((sitio) => ({ ...sitio, imagen: sitio.esSello ? sello : firma })));
}

/** Espera a que la imagen esté cargada, para cambiarla sin que parpadee. */
function precargar(url) {
  return new Promise((resolver) => {
    const imagen = new Image();
    imagen.onload = imagen.onerror = () => resolver(url);
    imagen.src = url;
  });
}

/** Suelta las miniaturas de versiones anteriores de las hojas (al cambiar la fecha o el sello). */
function soltarMiniaturasViejas() {
  const enUso = estado.resultado?.desnudo;
  for (const [pdf, porAncho] of estado.urls) {
    if (pdf === enUso) continue;
    for (const urls of porAncho.values()) urls.forEach((url) => URL.revokeObjectURL(url));
    estado.urls.delete(pdf);
  }
}

async function mostrarPrevias() {
  actualizarDatos();
  if (estado.modo === "pack") await mostrarPack();
  else await mostrarTarjetas();
  $("zona").hidden = true;
  soltarMiniaturasViejas();
  ajustarEspeciales();
}

/**
 * El panel de documentos especiales no baja más que las vistas previas: si hay más botones
 * de los que caben, se hace scroll dentro del panel. En el móvil va debajo y no se limita.
 */
function ajustarEspeciales() {
  const panel = $("especiales");
  const piezas = [...document.querySelectorAll(".tarjeta, .pila .hoja, .pila .etiqueta")].filter((el) => el.offsetParent !== null);
  if (panel.hidden || !piezas.length || matchMedia("(max-width: 720px)").matches) {
    panel.style.maxHeight = "";
    return;
  }
  const abajo = Math.max(...piezas.map((el) => el.getBoundingClientRect().bottom));
  panel.style.maxHeight = `${Math.max(160, Math.round(abajo - panel.getBoundingClientRect().top))}px`;
}

async function mostrarTarjetas() {
  const { resultado } = estado;
  const contenedor = $("tarjetas");
  const ancho = Math.round(300 * (window.devicePixelRatio || 1));
  const urls = await Promise.all((await urlsMiniaturas(resultado, ancho)).map(precargar));

  // Se reutilizan las tarjetas que ya están puestas: así no desaparecen y vuelven a aparecer.
  if (contenedor.children.length !== resultado.hojas.length) {
    contenedor.replaceChildren(...resultado.hojas.map(() => crearTarjeta()));
  }
  resultado.hojas.forEach((hoja, i) => actualizarTarjeta(contenedor.children[i], hoja, urls[i], resultado.trabajador));
  contenedor.hidden = false;
  $("pila").hidden = true;
}

function crearTarjeta() {
  const tarjeta = document.createElement("button");
  tarjeta.type = "button";
  tarjeta.className = "tarjeta";
  tarjeta.innerHTML = '<img alt=""><span class="leyenda"><span class="clave"></span>' +
    '<span class="detalle"><span class="en-reposo"></span><span class="al-pasar"></span><span class="hecho">✓ Descargado</span></span></span>';
  return tarjeta;
}

function actualizarTarjeta(tarjeta, hoja, url, trabajador) {
  const img = tarjeta.querySelector("img");
  img.alt = `Vista previa de ${hoja.clave}`;
  if (img.src !== url) img.src = url;
  tarjeta.title = `Descargar solo ${hoja.clave}`;
  tarjeta.querySelector(".clave").textContent = hoja.clave;
  tarjeta.querySelector(".en-reposo").textContent = `página ${hoja.paginaOrigen}`;
  tarjeta.querySelector(".al-pasar").textContent = `↓ Descargar ${hoja.clave}`;
  tarjeta.onclick = () => {
    descargar([[`${hoja.clave} - ${trabajador}.pdf`, hoja.pdf]]);
    tarjeta.classList.add("descargada");
    setTimeout(() => tarjeta.classList.remove("descargada"), 1800);
  };
}

async function mostrarPack() {
  $("pila").hidden = false;
  await colocarPila();
  $("tarjetas").hidden = true;
}

async function colocarPila() {
  const { resultado } = estado;
  const pila = $("pila");
  if (!resultado || pila.hidden) return;
  const n = resultado.hojas.length;
  const altoDisponible = pila.clientHeight - 12;
  const altoHoja = altoDisponible / (1 + DESFASE_PACK * (n - 1));
  const ancho = Math.max(100, Math.min(ANCHO_MAX_PACK, (altoHoja * 595) / 842, pila.clientWidth - RESERVA_ETIQUETAS_PACK));
  const alto = (ancho * 842) / 595;
  const desfase = alto * DESFASE_PACK;
  // Centrada, pero sin que las etiquetas de la derecha se salgan en pantallas estrechas.
  const x0 = Math.max(0, Math.min((pila.clientWidth - ancho) / 2, pila.clientWidth - ancho - RESERVA_ETIQUETAS_PACK));
  const y0 = Math.max(4, (pila.clientHeight - alto - desfase * (n - 1)) / 2);
  const resolucion = Math.round(ancho * (window.devicePixelRatio || 1));

  const urls = await Promise.all((await urlsMiniaturas(resultado, resolucion)).map(precargar));

  // Se reutilizan las hojas ya puestas (una hoja y su etiqueta por cada una) para que no parpadeen.
  if (pila.children.length !== n * 2) {
    pila.replaceChildren(...resultado.hojas.flatMap(() => {
      const marco = document.createElement("div");
      marco.className = "hoja";
      marco.innerHTML = '<img alt="">';
      const etiqueta = document.createElement("div");
      etiqueta.className = "etiqueta";
      etiqueta.innerHTML = "<strong></strong><span></span>";
      return [marco, etiqueta];
    }));
  }

  // De atrás hacia delante: la última hoja arriba del todo y la primera, entera delante.
  for (let posicion = 0; posicion < n; posicion++) {
    const indice = n - 1 - posicion;
    const hoja = resultado.hojas[indice];
    const y = y0 + posicion * desfase;
    const marco = pila.children[posicion * 2];
    const etiqueta = pila.children[posicion * 2 + 1];
    Object.assign(marco.style, { left: `${x0}px`, top: `${y}px`, width: `${ancho}px`, height: `${alto}px` });
    const img = marco.querySelector("img");
    img.alt = `Vista previa de ${hoja.clave}`;
    if (img.src !== urls[indice]) img.src = urls[indice];
    Object.assign(etiqueta.style, { left: `${x0 + ancho + 18}px`, top: `${y + 4}px` });
    etiqueta.querySelector("strong").textContent = hoja.clave;
    etiqueta.querySelector("span").textContent = `página ${hoja.paginaOrigen}`;
  }
  ajustarEspeciales();
}

// Descarga

async function descargar(archivos) {
  for (const [i, [nombre, bytes]] of archivos.entries()) {
    if (i) await pausa(350); // algunos navegadores ignoran descargas seguidas demasiado rápidas
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  ponerEstado(`✓ Descargado: ${archivos.map(([nombre]) => nombre).join(", ")}`, true);
}

async function descargarTodo() {
  const { resultado } = estado;
  if (!resultado) return;
  if (estado.modo === "pack") descargar([[`PACK - ${resultado.trabajador}.pdf`, await resultado.pack()]]);
  else descargar(resultado.hojas.map((hoja) => [`${hoja.clave} - ${resultado.trabajador}.pdf`, hoja.pdf]));
}

// Documentos especiales de plataformas

const plantillas = new Map();

async function plantillaDe(ruta) {
  if (!plantillas.has(ruta)) {
    const respuesta = await fetch(new URL(ruta, location.href));
    if (!respuesta.ok) throw new Error(`no se ha podido descargar la plantilla (${respuesta.status})`);
    plantillas.set(ruta, new Uint8Array(await respuesta.arrayBuffer()));
  }
  return plantillas.get(ruta);
}

async function descargarEspecial(especial) {
  const { resultado } = estado;
  if (!resultado) return;
  ponerEstado(`Preparando ${especial.boton}…`);
  await pausa();
  const datos = {
    trabajador: resultado.trabajador,
    dni: resultado.dni,
    puesto: resultado.puesto,
    firma: resultado.firma,
    fecha: new Date(),
  };
  try {
    datos.sello = await cargarSello();
    const archivos = [];
    for (const documento of documentosDe(especial)) {
      archivos.push([documento.archivo(datos), await generar(documento, await plantillaDe(documento.plantilla), datos)]);
    }
    await descargar(archivos);
  } catch (error) {
    ponerEstado("");
    await alerta("No se ha podido preparar el documento", `${especial.boton}: ${error.message ?? error}`);
  }
}

/**
 * El TA2 (informe de situación de alta) se rellena con el nombre, la fecha de nacimiento, el NAF y
 * el DNI/NIE que trae la hoja INFO del documento laboral cargado. La fecha de efectos del alta es
 * siempre la de hoy (no depende del interruptor "Poner fecha de hoy", que es para las hojas).
 */
async function descargarTA2() {
  const { resultado } = estado;
  if (!resultado) return;
  ponerEstado("Preparando el TA2…");
  await pausa();
  try {
    const { pdf } = await generarTA2(await plantillaDe(RUTA_TA2), await abrirCacheado(estado.documento.datos));
    await descargar([[`TA2 - ${resultado.trabajador}.pdf`, pdf]]);
  } catch (error) {
    ponerEstado("");
    await alerta("No se ha podido preparar el TA2", `${error.message ?? error}`);
  }
}

// ITA: el listado de trabajadores en alta

/**
 * Guarda un ITA en el navegador: lo lee (fecha, cuenta de cotización y todos sus trabajadores) y lo
 * mete en el almacén. Si ya había uno de esa misma cuenta y fecha, lo sustituye.
 */
async function anadirITA(datos, nombre) {
  ponerEstado(`Leyendo ${nombre}…`);
  await pausa();
  try {
    const ficha = await itas.leerITA(datos, nombre);
    await itas.guardarITA(ficha, datos);
    await refrescarITAs();
    ponerEstado(`✓ ITA del ${itas.fechaBonita(ficha.fecha)} guardado: ${ficha.trabajadores.length} trabajadores en alta.`, true);
    // Si ya había un documento laboral cargado, se vuelve a mirar con el ITA nuevo.
    if (estado.resultado) await buscarEnITAs(estado.resultado.dni);
  } catch (error) {
    ponerEstado("");
    await alerta("No se ha podido guardar el ITA", `${error.message ?? error}`);
  }
}

/**
 * Relee la lista de ITA guardados y pone al día el botón de la cabecera. De paso borra los que ya
 * pasan de diez días: con más de siete no valen para mandarlos a una empresa usuaria.
 */
async function refrescarITAs() {
  try {
    await itas.limpiarAntiguos();
    estado.itas = await itas.listarITAs();
  } catch {
    estado.itas = []; // navegador sin almacén disponible (p. ej. modo privado)
  }
  $("btn-itas").textContent = estado.itas.length ? `ITA guardados (${estado.itas.length})` : "ITA guardados";
}

/**
 * Mira si el trabajador cargado aparece en alguno de los ITA guardados y lo cuenta en la línea de
 * debajo de sus datos, con el botón para descargarlo.
 */
async function buscarEnITAs(dni) {
  const fila = $("fila-ita");
  const texto = $("texto-ita");
  const boton = $("btn-ita");
  estado.enITA = null;
  if (!estado.itas.length) {
    // Sin ITA guardados no se dice nada: la línea solo estorbaría.
    fila.hidden = true;
    return;
  }
  const encontrados = await itas.buscarTrabajador(dni, estado.itas);
  fila.hidden = false;
  if (!encontrados.length) {
    texto.textContent = `No aparece en ${estado.itas.length === 1 ? "el ITA guardado" : `ninguno de los ${estado.itas.length} ITA guardados`}`;
    texto.className = "pequeno suave";
    boton.hidden = true;
    return;
  }
  // Si el trabajador está en varios ITA se ofrece siempre el más reciente: `buscarTrabajador`
  // los devuelve ordenados por fecha, del más nuevo al más viejo, así que vale con el primero.
  const [mejor] = encontrados;
  estado.enITA = mejor;
  const cuando = mejor.dias === 0 ? "de hoy" : mejor.dias === 1 ? "de ayer" : `de hace ${mejor.dias} días`;
  const viejo = mejor.dias > itas.DIAS_VALIDO;
  // "· también en otro" si hay dos, "· también en otros 3" si hay más
  const sobran = encontrados.length - 1;
  const otros = sobran > 0 ? ` · también en ${sobran === 1 ? "otro" : `otros ${sobran}`}` : "";
  texto.textContent = `${viejo ? "⚠" : "✓"} En alta en el ITA del ${itas.fechaBonita(mejor.ita.fecha)} (${cuando}${viejo ? ", más de 7 días" : ""}), página ${mejor.trabajador.pagina}${otros}`;
  texto.className = viejo ? "pequeno aviso" : "pequeno ok";
  boton.hidden = false;
}

/** Descarga el ITA donde está el trabajador, avisando antes si ya tiene más de 7 días. */
async function descargarITA() {
  const encontrado = estado.enITA;
  if (!encontrado) return;
  if (encontrado.dias > itas.DIAS_VALIDO) {
    const seguir = await confirmar(
      "El ITA tiene más de 7 días",
      `El ITA en el que aparece ${estado.resultado?.trabajador ?? "el trabajador"} es del ${itas.fechaBonita(encontrado.ita.fecha)}, de hace ${encontrado.dias} días.

Las empresas usuarias no suelen aceptarlo con más de 7 días: descarga un ITA del día en el Sistema RED y añádelo aquí.

¿Lo descargas igualmente?`,
      "Descargar igualmente");
    if (!seguir) return;
  }
  try {
    const pdf = await itas.pdfDeITA(encontrado.ita.id);
    const nombre = estado.resultado?.trabajador ?? encontrado.trabajador.nombre;
    await descargar([[`ITA ${itas.fechaBonita(encontrado.ita.fecha).replace(/\//g, "-")} - ${nombre}.pdf`, pdf]]);
  } catch (error) {
    await alerta("No se ha podido descargar el ITA", `${error.message ?? error}`);
  }
}

/** Abre la ventana con los ITA guardados. */
async function abrirITAs() {
  await refrescarITAs();
  pintarListaITAs();
  $("dialogo-itas").showModal();
}

/** Dibuja la lista de ITA guardados, cada uno con su botón de quitar. */
function pintarListaITAs() {
  const lista = $("lista-itas");
  lista.replaceChildren();
  if (!estado.itas.length) {
    const vacio = document.createElement("p");
    vacio.className = "pequeno suave";
    vacio.textContent = "Todavía no hay ningún ITA guardado.";
    lista.append(vacio);
    return;
  }
  for (const ficha of estado.itas) {
    const dias = itas.diasDesde(ficha.fecha);
    const viejo = dias > itas.DIAS_VALIDO;

    const linea = document.createElement("div");
    linea.className = "linea-ita";

    const datos = document.createElement("span");
    datos.className = "pequeno";
    datos.textContent = `${viejo ? "⚠" : "✓"} ${itas.fechaBonita(ficha.fecha)} · ${ficha.trabajadores.length} trabajadores · ${ficha.paginas} páginas${viejo ? ` · ${dias} días` : ""}`;
    if (viejo) datos.classList.add("aviso");

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "enlace pequeno";
    quitar.textContent = "Quitar";
    quitar.addEventListener("click", enOrden(async () => {
      await itas.borrarITA(ficha.id);
      await refrescarITAs();
      pintarListaITAs();
      if (estado.resultado) await buscarEnITAs(estado.resultado.dni);
    }));

    linea.append(datos, quitar);
    lista.append(linea);
  }
}

function crearBotonesEspeciales() {
  const contenedor = $("botones-especiales");
  for (const especial of ESPECIALES) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "boton secundario";
    boton.textContent = especial.boton;
    const cuantos = documentosDe(especial).length;
    boton.title = cuantos > 1
      ? `Descargar los ${cuantos} documentos de ${especial.boton} rellenos con los datos del trabajador`
      : `Descargar el documento de ${especial.boton} relleno con los datos del trabajador`;
    boton.addEventListener("click", enOrden(() => descargarEspecial(especial)));
    contenedor.append(boton);
  }
}

// Utilidades de interfaz

function ponerEstado(texto, destacado = false) {
  $("estado").textContent = texto;
  $("estado").classList.toggle("ok", destacado);
}

const pausa = (ms = 0) => new Promise((resolver) => requestAnimationFrame(() => setTimeout(resolver, ms)));

function dialogo(titulo, texto, textoSi, textoNo) {
  const ventana = $("dialogo");
  $("dialogo-titulo").textContent = titulo;
  $("dialogo-texto").textContent = texto;
  $("dialogo-si").textContent = textoSi;
  $("dialogo-no").textContent = textoNo ?? "";
  $("dialogo-no").hidden = !textoNo;
  return new Promise((resolver) => {
    const cerrar = (valor) => {
      ventana.close();
      resolver(valor);
    };
    $("dialogo-si").onclick = () => cerrar(true);
    $("dialogo-no").onclick = () => cerrar(false);
    ventana.oncancel = (evento) => {
      evento.preventDefault();
      cerrar(false);
    };
    ventana.showModal();
    $("dialogo-si").focus();
  });
}

const alerta = (titulo, texto) => dialogo(titulo, texto, "Aceptar");
const confirmar = (titulo, texto, textoSi) => dialogo(titulo, texto, textoSi, "No");

// Las acciones del usuario se hacen de una en una, en el orden en que llegan. Leer y generar los PDF
// no bloquea la página, así que sin esto pulsar algo mientras se procesa (p. ej. «Pack» mientras se
// cambia la fecha) podría mezclar los resultados.
let cola = Promise.resolve();

function enOrden(accion) {
  return (...argumentos) => {
    const hecha = cola.then(() => accion(...argumentos));
    cola = hecha.catch(() => {});
    return hecha;
  };
}

function enlazarArchivo(boton, input, accion) {
  if (boton) $(boton).addEventListener("click", () => $(input).click());
  $(input).addEventListener("change", async () => {
    const archivo = $(input).files[0];
    $(input).value = ""; // permite volver a elegir el mismo archivo
    if (archivo) await accion(archivo);
  });
}

function esImagen(archivo) {
  return archivo.type.startsWith("image/") || /\.(png|jpe?g|bmp)$/i.test(archivo.name);
}

// Arranque

function iniciar() {
  enlazarArchivo("btn-documento", "input-documento", enOrden(cargarDocumento));
  enlazarArchivo("btn-firma", "input-firma", enOrden(cargarFirmaArchivo));
  $("quitar-firma").addEventListener("click", enOrden(quitarFirma));
  $("fecha-hoy").addEventListener("change", enOrden(cambiarFecha));
  $("con-sello").addEventListener("change", enOrden(cambiarSello));
  $("btn-descargar").addEventListener("click", enOrden(descargarTodo));
  $("btn-ta2").addEventListener("click", enOrden(descargarTA2));
  $("btn-ita").addEventListener("click", enOrden(descargarITA));
  $("btn-itas").addEventListener("click", enOrden(abrirITAs));
  $("anadir-ita").addEventListener("click", () => $("input-ita").click());
  $("cerrar-itas").addEventListener("click", () => $("dialogo-itas").close());
  $("input-ita").addEventListener("change", enOrden(async () => {
    const archivos = [...$("input-ita").files];
    $("input-ita").value = ""; // permite volver a elegir el mismo archivo
    for (const archivo of archivos) await anadirITA(new Uint8Array(await archivo.arrayBuffer()), archivo.name);
    if ($("dialogo-itas").open) pintarListaITAs();
  }));

  for (const boton of document.querySelectorAll(".selector button")) {
    const mostrarModo = enOrden(async () => {
      if (estado.resultado) await mostrarPrevias();
    });
    boton.addEventListener("click", () => {
      estado.modo = boton.dataset.modo;
      for (const otro of document.querySelectorAll(".selector button")) otro.setAttribute("aria-checked", String(otro === boton));
      mostrarModo();
    });
  }

  // Pegar una captura de la firma (Win + Mayús + S y luego Ctrl + V).
  document.addEventListener("paste", async (evento) => {
    const item = [...(evento.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    if (!item) {
      if (!evento.target.closest?.("input, textarea")) {
        await alerta("No hay ninguna captura", "No hay ninguna imagen copiada.\n\nHaz la captura de la firma con Win + Mayús + S y vuelve a pulsar Ctrl + V.");
      }
      return;
    }
    evento.preventDefault();
    const datos = new Uint8Array(await item.getAsFile().arrayBuffer());
    await enOrden(usarFirma)(() => firmas.desdeImagen(datos, "captura pegada"));
  });

  // Arrastrar y soltar: PDF -> documento laboral (o firma si se está esperando una); imagen -> firma.
  let profundidad = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    profundidad++;
    $("zona").classList.add("arrastrando");
  });
  window.addEventListener("dragleave", () => {
    if (--profundidad <= 0) $("zona").classList.remove("arrastrando");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    profundidad = 0;
    $("zona").classList.remove("arrastrando");
    for (const archivo of e.dataTransfer?.files ?? []) {
      const esPdf = archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
      if (esImagen(archivo) || (esPdf && esperandoFirma())) return enOrden(cargarFirmaArchivo)(archivo);
      if (esPdf) return enOrden(cargarDocumento)(archivo);
    }
    await alerta("Archivo no válido", "Arrastra un documento PDF o una captura de la firma.");
  });

  new ResizeObserver(() => colocarPila()).observe($("pila"));
  new ResizeObserver(() => ajustarEspeciales()).observe($("tarjetas"));

  crearBotonesEspeciales();
  refrescarITAs(); // los ITA guardados de otras veces
  for (const id of ["btn-documento", "btn-firma"]) $(id).disabled = false;
  cargarSello().catch(() => {}); // se va descargando; si falla, se avisa al activar el interruptor
  try {
    localStorage.removeItem("firmador-documentos:sello"); // sobra: antes se guardaba aquí
  } catch {
    // sin almacenamiento disponible: nada que limpiar
  }
  limpiar();
  window.firmadorListo = true;
  setTimeout(calentarMotor, 0);
}

/**
 * La primera vez que se usa cada parte del motor de PDF va bastante más lenta. Al abrir la web se
 * ensaya con una plantilla pequeña (y el sello) para que el primer documento se vea igual de rápido
 * que los siguientes. Si falla, no pasa nada: solo iría algo más lento.
 */
async function calentarMotor() {
  try {
    const pdf = await calentar(await plantillaDe(RUTA_CALENTAR), await cargarSello());
    await miniatura(pdf, 300);
  } catch {
    // sin conexión o sin la plantilla: el primer documento irá un poco más lento, sin más
  }
}

iniciar();
