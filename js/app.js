// Interfaz: cargar el documento laboral (y, si hace falta, la firma y el sello), previsualizar y descargar.

import { fechaDeHoy } from "./fecha.js";
import * as firmas from "./firma.js";
import { ErrorProcesado, FirmaNoEncontrada, procesar } from "./pdf.js";
import { miniatura } from "./pdfutil.js";

const $ = (id) => document.getElementById(id);
const CLAVE_SELLO = "firmador-documentos:sello";
const DESFASE_PACK = 0.13; // parte de cada hoja de detrás que asoma en la vista del pack
const ANCHO_MAX_PACK = 380;

const estado = {
  documento: null, // { nombre, datos } del documento laboral cargado
  firma: null, // firma cargada aparte; si no hay, se usa la del documento
  resultado: null,
  sello: leerSello(),
  modo: "separados",
  urls: new Map(), // miniaturas ya generadas (bytes del PDF -> URL)
};

// Sello: se guarda solo en este navegador, nunca se publica con la web.

function leerSello() {
  try {
    const guardado = localStorage.getItem(CLAVE_SELLO);
    return guardado ? Uint8Array.from(atob(guardado), (c) => c.charCodeAt(0)) : null;
  } catch {
    return null;
  }
}

function guardarSello(bytes) {
  estado.sello = bytes;
  try {
    let binario = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem(CLAVE_SELLO, btoa(binario));
    return true;
  } catch {
    return false; // navegador en modo privado o sin almacenamiento: vale para esta sesión
  }
}

// Documento laboral

async function cargarDocumento(archivo) {
  const datos = new Uint8Array(await archivo.arrayBuffer());
  if (estado.firma?.usada) estado.firma = null; // ya sirvió para el anterior, normalmente de otro trabajador
  estado.documento = { nombre: archivo.name, datos };
  await procesarDocumento();
}

async function procesarDocumento() {
  const { nombre, datos } = estado.documento;
  limpiar();
  $("archivo").textContent = nombre;
  if (!estado.sello) {
    pedirSello();
    return;
  }
  ponerEstado("Procesando…");
  await pausa();

  let resultado;
  try {
    resultado = procesar(datos, { fecha: fechaElegida(), imagenFirma: estado.firma?.imagen, sello: estado.sello });
  } catch (error) {
    if (error instanceof FirmaNoEncontrada) {
      pedirFirma();
      return;
    }
    estado.documento = null;
    ponerEstado("No se ha podido procesar el documento.");
    await alerta("No se ha podido procesar", error instanceof ErrorProcesado ? error.message : `Ha ocurrido un error inesperado:\n${error}`);
    return;
  }

  if (estado.firma && !estado.firma.esDe(resultado.dni)) {
    const usar = await confirmar(
      "La firma es de otra persona",
      `La firma cargada es de ${estado.firma.nombre} (NIF ${estado.firma.nif}), pero el documento es de ${resultado.trabajador} (DNI ${resultado.dni}).\n\n¿Quieres usar esta firma igualmente?`,
      "Usar igualmente",
    );
    if (!usar) {
      estado.firma = null;
      await procesarDocumento();
      return;
    }
  }
  if (estado.firma) estado.firma.usada = true;

  estado.resultado = resultado;
  mostrarPrevias();
  $("btn-descargar").disabled = false;
  ponerEstado("Listo. Pulsa Descargar, o pincha en una hoja para descargar solo esa.");
  await avisarFecha();
}

function limpiar() {
  estado.resultado = null;
  for (const url of estado.urls.values()) URL.revokeObjectURL(url);
  estado.urls.clear();
  $("tarjetas").hidden = true;
  $("tarjetas").replaceChildren();
  $("pila").hidden = true;
  $("pila").replaceChildren();
  if (!estado.sello) pedirSello();
  else mostrarZona("Arrastra aquí el documento laboral", "o pulsa «Cargar documentos laborales»", () => $("input-documento").click());
  $("btn-descargar").disabled = true;
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
  mostrarZona("Este documento no está firmado", "Pulsa «Cargar firma» (PDF firmado o captura) o pega una captura con Ctrl+V", () => $("input-firma").click());
}

function pedirSello() {
  ponerEstado("Falta el sello de la empresa. Solo hay que cargarlo la primera vez en este ordenador.");
  mostrarZona("Carga el sello de la empresa", "Pulsa aquí y elige la imagen del sello (solo la primera vez en este ordenador)", () => $("input-sello").click());
}

const esperandoFirma = () => estado.documento && !estado.resultado && estado.sello;

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
    firma = obtener();
  } catch (error) {
    ponerEstado("");
    await alerta("No se ha podido cargar la firma", error instanceof ErrorProcesado ? error.message : `Ha ocurrido un error inesperado:\n${error}`);
    return;
  }
  estado.firma = firma;
  if (estado.documento) {
    await procesarDocumento(); // se aplica al documento que ya está cargado
  } else {
    actualizarDatos();
    ponerEstado("Firma cargada. Ahora carga el documento laboral.");
  }
}

async function quitarFirma() {
  estado.firma = null;
  if (estado.documento) await procesarDocumento();
  else {
    actualizarDatos();
    ponerEstado("");
  }
}

// Sello

async function cargarSelloArchivo(archivo) {
  const datos = new Uint8Array(await archivo.arrayBuffer());
  try {
    firmas.validarImagen(datos);
  } catch (error) {
    await alerta("No se ha podido cargar el sello", error.message);
    return;
  }
  const guardado = guardarSello(datos);
  actualizarSello();
  if (estado.documento) await procesarDocumento();
  else limpiar();
  ponerEstado(guardado ? "Sello guardado en este navegador." : "Sello cargado (este navegador no permite guardarlo: habrá que cargarlo en cada uso).", true);
}

function actualizarSello() {
  $("estado-sello").textContent = estado.sello ? "Sello cargado" : "Falta el sello";
  $("btn-sello").textContent = estado.sello ? "Cambiar" : "Cargar sello";
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
    estado.resultado.ponerFecha(fechaElegida());
  } catch (error) {
    estado.resultado.ponerFecha(null);
    $("fecha-hoy").checked = false;
    await alerta("Error inesperado", `No se ha podido cambiar la fecha:\n${error}`);
  }
  mostrarPrevias();
  ponerEstado("Listo. Pulsa Descargar, o pincha en una hoja para descargar solo esa.");
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
    texto.textContent = resultado ? "Firma: la del propio documento" : "Firma: la del documento, o pulsa «Cargar firma» / pega una captura con Ctrl+V";
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

function urlMiniatura(pdf, ancho) {
  const clave = `${ancho}`;
  let porPdf = estado.urls.get(pdf);
  if (!porPdf) {
    porPdf = new Map();
    estado.urls.set(pdf, porPdf);
  }
  if (!porPdf.has(clave)) porPdf.set(clave, URL.createObjectURL(new Blob([miniatura(pdf, ancho)], { type: "image/png" })));
  return porPdf.get(clave);
}

function mostrarPrevias() {
  actualizarDatos();
  $("zona").hidden = true;
  if (estado.modo === "pack") mostrarPack();
  else mostrarTarjetas();
}

function mostrarTarjetas() {
  const { resultado } = estado;
  $("pila").hidden = true;
  const contenedor = $("tarjetas");
  contenedor.replaceChildren();
  const ancho = Math.round(300 * (window.devicePixelRatio || 1));
  for (const hoja of resultado.hojas) {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta";
    tarjeta.title = `Descargar solo ${hoja.clave}`;
    const img = document.createElement("img");
    img.alt = `Vista previa de ${hoja.clave}`;
    img.src = urlMiniatura(hoja.pdf, ancho);
    const leyenda = document.createElement("span");
    leyenda.className = "leyenda";
    leyenda.innerHTML = `<span class="clave"></span><span class="detalle"><span class="en-reposo"></span><span class="al-pasar"></span><span class="hecho">✓ Descargado</span></span>`;
    leyenda.querySelector(".clave").textContent = hoja.clave;
    leyenda.querySelector(".en-reposo").textContent = `página ${hoja.paginaOrigen}`;
    leyenda.querySelector(".al-pasar").textContent = `↓ Descargar ${hoja.clave}`;
    tarjeta.append(img, leyenda);
    tarjeta.addEventListener("click", () => {
      descargar([[`${hoja.clave} - ${resultado.trabajador}.pdf`, hoja.pdf]]);
      tarjeta.classList.add("descargada");
      setTimeout(() => tarjeta.classList.remove("descargada"), 1800);
    });
    contenedor.append(tarjeta);
  }
  contenedor.hidden = false;
}

function mostrarPack() {
  $("tarjetas").hidden = true;
  const pila = $("pila");
  pila.hidden = false;
  colocarPila();
}

function colocarPila() {
  const { resultado } = estado;
  const pila = $("pila");
  if (!resultado || pila.hidden) return;
  const n = resultado.hojas.length;
  const altoDisponible = pila.clientHeight - 12;
  const altoHoja = altoDisponible / (1 + DESFASE_PACK * (n - 1));
  const ancho = Math.max(120, Math.min(ANCHO_MAX_PACK, (altoHoja * 595) / 842));
  const alto = (ancho * 842) / 595;
  const desfase = alto * DESFASE_PACK;
  const x0 = (pila.clientWidth - ancho) / 2;
  const y0 = Math.max(4, (pila.clientHeight - alto - desfase * (n - 1)) / 2);
  const resolucion = Math.round(ancho * (window.devicePixelRatio || 1));

  pila.replaceChildren();
  // De atrás hacia delante: la última hoja arriba del todo y la primera, entera delante.
  for (let posicion = 0; posicion < n; posicion++) {
    const hoja = resultado.hojas[n - 1 - posicion];
    const y = y0 + posicion * desfase;
    const marco = document.createElement("div");
    marco.className = "hoja";
    Object.assign(marco.style, { left: `${x0}px`, top: `${y}px`, width: `${ancho}px`, height: `${alto}px` });
    const img = document.createElement("img");
    img.alt = `Vista previa de ${hoja.clave}`;
    img.src = urlMiniatura(hoja.pdf, resolucion);
    marco.append(img);
    const etiqueta = document.createElement("div");
    etiqueta.className = "etiqueta";
    Object.assign(etiqueta.style, { left: `${x0 + ancho + 18}px`, top: `${y + 4}px` });
    etiqueta.innerHTML = "<strong></strong><span></span>";
    etiqueta.querySelector("strong").textContent = hoja.clave;
    etiqueta.querySelector("span").textContent = `página ${hoja.paginaOrigen}`;
    pila.append(marco, etiqueta);
  }
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

function descargarTodo() {
  const { resultado } = estado;
  if (!resultado) return;
  if (estado.modo === "pack") descargar([[`PACK - ${resultado.trabajador}.pdf`, resultado.pack()]]);
  else descargar(resultado.hojas.map((hoja) => [`${hoja.clave} - ${resultado.trabajador}.pdf`, hoja.pdf]));
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
  enlazarArchivo("btn-documento", "input-documento", cargarDocumento);
  enlazarArchivo("btn-firma", "input-firma", cargarFirmaArchivo);
  enlazarArchivo("btn-sello", "input-sello", cargarSelloArchivo);
  $("quitar-firma").addEventListener("click", quitarFirma);
  $("fecha-hoy").addEventListener("change", cambiarFecha);
  $("btn-descargar").addEventListener("click", descargarTodo);

  for (const boton of document.querySelectorAll(".selector button")) {
    boton.addEventListener("click", () => {
      estado.modo = boton.dataset.modo;
      for (const otro of document.querySelectorAll(".selector button")) otro.setAttribute("aria-checked", String(otro === boton));
      if (estado.resultado) mostrarPrevias();
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
    await usarFirma(() => firmas.desdeImagen(datos, "captura pegada"));
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
      if (esImagen(archivo) && !estado.sello) return cargarSelloArchivo(archivo);
      if (esImagen(archivo) || (esPdf && esperandoFirma())) return cargarFirmaArchivo(archivo);
      if (esPdf) return cargarDocumento(archivo);
    }
    await alerta("Archivo no válido", "Arrastra un documento PDF o una captura de la firma.");
  });

  new ResizeObserver(() => colocarPila()).observe($("pila"));

  const [usuario] = location.hostname.endsWith(".github.io") ? location.hostname.split(".") : [];
  const repositorio = location.pathname.split("/").filter(Boolean)[0];
  if (usuario && repositorio) $("enlace-codigo").href = `https://github.com/${usuario}/${repositorio}`;

  for (const id of ["btn-documento", "btn-firma"]) $(id).disabled = false;
  actualizarSello();
  limpiar();
  window.firmadorListo = true;
}

iniciar();
