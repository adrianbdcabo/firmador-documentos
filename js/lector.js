// © 2026 Adrián Barroso de Cabo.
// Lector del contenido de una página PDF: interpreta sus operadores para saber qué letra se
// dibuja en cada sitio (con su fuente, tamaño, color y posición), dónde están las imágenes y
// dónde está cada operador en el stream, para poder modificarlo (el cambio de fecha).
//
// Las posiciones salen en coordenadas de pantalla (origen arriba a la izquierda, en puntos) y las
// líneas de texto se agrupan igual que se leen: letras seguidas en la misma línea base.

import { fuenteDe } from "./fuentes.js";
import {
  IDENTIDAD,
  PDFArray,
  PDFDict,
  PDFName,
  PDFStream,
  aplicar,
  comoArray,
  comoNombre,
  comoNumero,
  contenidoPagina,
  heredado,
  leerStream,
  limites,
  multiplicar,
  obtener,
  resolver,
  transformacion,
  transformarRect,
} from "./pdfbase.js";

// ---------------------------------------------------------------- léxico

const ESPACIO = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) ESPACIO[c] = 1;
const DELIMITADOR = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIMITADOR[c.charCodeAt(0)] = 1;

class Lexico {
  constructor(bytes) {
    this.b = bytes;
    this.i = 0;
  }

  saltarEspacios() {
    const b = this.b;
    while (this.i < b.length) {
      const c = b[this.i];
      if (ESPACIO[c]) this.i++;
      else if (c === 0x25) {
        while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++;
      } else break;
    }
  }

  /** Siguiente elemento: { tipo, valor, inicio, fin } o null al final. */
  siguiente() {
    this.saltarEspacios();
    const b = this.b;
    if (this.i >= b.length) return null;
    const inicio = this.i;
    const c = b[this.i];
    if (c === 0x28) return { tipo: "texto", valor: this.#literal(), inicio, fin: this.i };
    if (c === 0x3c) {
      if (b[this.i + 1] === 0x3c) {
        this.i += 2;
        return { tipo: "dict", valor: this.#diccionario(), inicio, fin: this.i };
      }
      return { tipo: "texto", valor: this.#hex(), inicio, fin: this.i };
    }
    if (c === 0x5b) {
      this.i++;
      const lista = [];
      for (;;) {
        this.saltarEspacios();
        if (this.i >= b.length) break;
        if (b[this.i] === 0x5d) {
          this.i++;
          break;
        }
        const elemento = this.siguiente();
        if (!elemento) break;
        lista.push(elemento);
      }
      return { tipo: "array", valor: lista, inicio, fin: this.i };
    }
    if (c === 0x2f) {
      this.i++;
      let nombre = "";
      while (this.i < b.length && !ESPACIO[b[this.i]] && !DELIMITADOR[b[this.i]]) {
        if (b[this.i] === 0x23 && this.i + 2 < b.length) {
          nombre += String.fromCharCode(parseInt(String.fromCharCode(b[this.i + 1], b[this.i + 2]), 16));
          this.i += 3;
        } else nombre += String.fromCharCode(b[this.i++]);
      }
      return { tipo: "nombre", valor: nombre, inicio, fin: this.i };
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.i++;
      return { tipo: "raro", valor: String.fromCharCode(c), inicio, fin: this.i };
    }
    let palabra = "";
    while (this.i < b.length && !ESPACIO[b[this.i]] && !DELIMITADOR[b[this.i]]) palabra += String.fromCharCode(b[this.i++]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palabra)) return { tipo: "numero", valor: parseFloat(palabra), inicio, fin: this.i };
    if (/^[+-]?\d*\.?\d*$/.test(palabra) && palabra !== "") return { tipo: "numero", valor: parseFloat(palabra) || 0, inicio, fin: this.i };
    if (palabra === "true" || palabra === "false") return { tipo: "bool", valor: palabra === "true", inicio, fin: this.i };
    if (palabra === "null") return { tipo: "null", valor: null, inicio, fin: this.i };
    return { tipo: "operador", valor: palabra, inicio, fin: this.i };
  }

  #literal() {
    const b = this.b;
    this.i++;
    const salida = [];
    let nivel = 1;
    while (this.i < b.length) {
      const c = b[this.i++];
      if (c === 0x5c) {
        const e = b[this.i++];
        if (e >= 0x30 && e <= 0x37) {
          let valor = e - 0x30;
          for (let k = 0; k < 2 && b[this.i] >= 0x30 && b[this.i] <= 0x37; k++) valor = valor * 8 + b[this.i++] - 0x30;
          salida.push(valor & 0xff);
        } else if (e === 0x6e) salida.push(10);
        else if (e === 0x72) salida.push(13);
        else if (e === 0x74) salida.push(9);
        else if (e === 0x62) salida.push(8);
        else if (e === 0x66) salida.push(12);
        else if (e === 13) {
          if (b[this.i] === 10) this.i++;
        } else if (e !== 10) salida.push(e);
      } else if (c === 0x28) {
        nivel++;
        salida.push(c);
      } else if (c === 0x29) {
        if (--nivel === 0) break;
        salida.push(c);
      } else salida.push(c);
    }
    return Uint8Array.from(salida);
  }

  #hex() {
    const b = this.b;
    this.i++;
    let digitos = "";
    while (this.i < b.length && b[this.i] !== 0x3e) {
      const c = b[this.i++];
      if (!ESPACIO[c]) digitos += String.fromCharCode(c);
    }
    this.i++;
    if (digitos.length % 2) digitos += "0";
    const salida = new Uint8Array(digitos.length / 2);
    for (let k = 0; k < salida.length; k++) salida[k] = parseInt(digitos.slice(k * 2, k * 2 + 2), 16) || 0;
    return salida;
  }

  #diccionario() {
    const b = this.b;
    const dict = {};
    for (;;) {
      this.saltarEspacios();
      if (this.i >= b.length) break;
      if (b[this.i] === 0x3e && b[this.i + 1] === 0x3e) {
        this.i += 2;
        break;
      }
      const clave = this.siguiente();
      if (!clave) break;
      if (clave.tipo !== "nombre") continue;
      const valor = this.siguiente();
      dict[clave.valor] = valor;
    }
    return dict;
  }

  /** Salta los datos binarios de una imagen incrustada (después de "ID") hasta "EI". */
  saltarImagenIncrustada() {
    const b = this.b;
    this.i++; // el espacio tras ID
    for (let i = this.i; i + 1 < b.length; i++) {
      if (b[i] === 0x45 && b[i + 1] === 0x49 && (i === 0 || ESPACIO[b[i - 1]]) && (i + 2 >= b.length || ESPACIO[b[i + 2]] || DELIMITADOR[b[i + 2]])) {
        this.i = i + 2;
        return;
      }
    }
    this.i = b.length;
  }
}

/** Operadores de un contenido: [{ op, operandos, inicio, fin }], con las posiciones en bytes. */
export function operadores(bytes) {
  const lexico = new Lexico(bytes);
  const lista = [];
  let operandos = [];
  for (;;) {
    const elemento = lexico.siguiente();
    if (!elemento) break;
    if (elemento.tipo !== "operador") {
      operandos.push(elemento);
      continue;
    }
    const op = elemento.valor;
    const inicio = operandos.length ? operandos[0].inicio : elemento.inicio;
    if (op === "BI") {
      // imagen incrustada: diccionario hasta ID, datos binarios hasta EI
      const dict = {};
      for (;;) {
        const clave = lexico.siguiente();
        if (!clave || (clave.tipo === "operador" && clave.valor === "ID")) break;
        const valor = lexico.siguiente();
        if (clave.tipo === "nombre") dict[clave.valor] = valor;
      }
      lexico.saltarImagenIncrustada();
      lista.push({ op: "BI", operandos: [{ tipo: "dict", valor: dict }], inicio, fin: lexico.i });
    } else {
      lista.push({ op, operandos, inicio, fin: elemento.fin });
    }
    operandos = [];
  }
  return lista;
}

// ---------------------------------------------------------------- intérprete

const num = (o) => (o && o.tipo === "numero" ? o.valor : 0);

function colorARgb(componentes) {
  if (componentes.length >= 4) {
    const [c, m, y, k] = componentes;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  if (componentes.length === 3) return [...componentes];
  if (componentes.length === 1) return [componentes[0], componentes[0], componentes[0]];
  return [0, 0, 0];
}

function componentesDeEspacio(doc, recursos, nombreEspacio) {
  if (nombreEspacio === "DeviceGray" || nombreEspacio === "G" || nombreEspacio === "CalGray") return 1;
  if (nombreEspacio === "DeviceRGB" || nombreEspacio === "RGB" || nombreEspacio === "CalRGB" || nombreEspacio === "Lab") return 3;
  if (nombreEspacio === "DeviceCMYK" || nombreEspacio === "CMYK") return 4;
  if (nombreEspacio === "Pattern") return 0;
  const definido = obtener(doc, obtener(doc, recursos, "ColorSpace"), nombreEspacio);
  const lista = comoArray(doc, definido);
  const tipo = comoNombre(lista?.[0] ?? definido);
  if (tipo === "ICCBased") return comoNumero(obtener(doc, lista[1], "N")) ?? 3;
  if (tipo === "Indexed" || tipo === "Separation") return 1;
  if (tipo === "DeviceN") return comoArray(doc, lista[1])?.length ?? 1;
  return componentesDeEspacio(doc, recursos, tipo ?? "DeviceGray");
}

/**
 * Interpreta la página y devuelve:
 * - `glifos`: cada letra dibujada, en el orden en que se dibuja;
 * - `imagenes`: cada imagen con su caja y su objeto;
 * - `ops`: los operadores del contenido de la página (para poder modificarlo);
 * - `bytes`: el contenido de la página descomprimido.
 * Con `anotaciones` se incluye también el aspecto visible de las anotaciones (p. ej. la firma).
 */
export function interpretar(doc, pagina, { anotaciones = false } = {}) {
  const aPantalla = transformacion(doc, pagina);
  const caja = limites(doc, pagina);
  const recursos = heredado(doc, pagina.node, "Resources");
  const bytes = contenidoPagina(doc, pagina);
  const ops = operadores(bytes);
  const resultado = { glifos: [], imagenes: [], ops, bytes, caja };
  ejecutar(doc, ops, recursos, IDENTIDAD, { resultado, aPantalla, caja, nivel: 0, vistos: new Set(), recorte: caja });
  resultado.finPagina = resultado.glifos.length; // lo que sigue es de las anotaciones
  if (anotaciones) ejecutarAnotaciones(doc, pagina, { resultado, aPantalla, caja, vistos: new Set() });
  return resultado;
}

function ejecutarAnotaciones(doc, pagina, contexto) {
  for (const anotacion of comoArray(doc, pagina.node.get(PDFName.of("Annots"))) ?? []) {
    if (!(anotacion instanceof PDFDict)) continue;
    const opciones = comoNumero(obtener(doc, anotacion, "F")) ?? 0;
    if (opciones & 2 || opciones & 32) continue; // oculta / no se ve
    const rect = comoArray(doc, obtener(doc, anotacion, "Rect"))?.map(comoNumero);
    let aspecto = obtener(doc, obtener(doc, anotacion, "AP"), "N");
    if (aspecto instanceof PDFDict && !(aspecto instanceof PDFStream)) {
      const estado = comoNombre(obtener(doc, anotacion, "AS"));
      aspecto = estado ? obtener(doc, aspecto, estado) : undefined;
    }
    if (!(aspecto instanceof PDFStream) || !rect || rect.length !== 4) continue;
    const matriz = matrizDeAspecto(doc, aspecto, rect);
    if (!matriz) continue;
    ejecutarForm(doc, aspecto, matriz, IDENTIDAD, null, { ...contexto, nivel: 1, recorte: contexto.caja });
  }
}

/** Matriz que lleva el aspecto de una anotación (su BBox) a su rectángulo en la página. */
export function matrizDeAspecto(doc, aspecto, rect) {
  const bbox = comoArray(doc, obtener(doc, aspecto, "BBox"))?.map(comoNumero);
  if (!bbox || bbox.length !== 4) return null;
  const matrizForm = comoArray(doc, obtener(doc, aspecto, "Matrix"))?.map(comoNumero) ?? IDENTIDAD;
  const [bx0, by0, bx1, by1] = transformarRect(matrizForm, bbox);
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const sx = bx1 - bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1;
  const sy = by1 - by0 ? (ry1 - ry0) / (by1 - by0) : 1;
  return multiplicar(matrizForm, [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy]);
}

function ejecutarForm(doc, form, matrizExtra, ctmPadre, recursosPadre, contexto) {
  if (contexto.nivel > 12 || contexto.vistos.has(form)) return;
  contexto.vistos.add(form);
  const matriz = comoArray(doc, obtener(doc, form, "Matrix"))?.map(comoNumero) ?? IDENTIDAD;
  const recursos = obtener(doc, form, "Resources") ?? recursosPadre;
  let bytes;
  try {
    bytes = leerStream(form);
  } catch {
    contexto.vistos.delete(form);
    return;
  }
  const ctm = multiplicar(multiplicar(matriz, matrizExtra), ctmPadre);
  ejecutar(doc, operadores(bytes), recursos, ctm, { ...contexto, nivel: contexto.nivel + 1 });
  contexto.vistos.delete(form);
}

function ejecutar(doc, ops, recursos, ctmInicial, contexto) {
  const { resultado, aPantalla, caja } = contexto;
  const pila = [];
  let gs = {
    ctm: ctmInicial,
    recorte: contexto.recorte ?? caja, // zona visible (los recortes con W), en coordenadas de pantalla
    recorteExplicito: contexto.recorteExplicito ?? false, // false: la zona es la página entera
    espacioRelleno: 1,
    relleno: [0],
    fuente: null,
    tamano: 0,
    tc: 0,
    tw: 0,
    th: 1,
    tl: 0,
    ts: 0,
    tr: 0,
  };
  let tm = [...IDENTIDAD];
  let tlm = [...IDENTIDAD];
  let trazado = null; // caja del trazado en curso (para los recortes)
  let recortar = false;
  const anadirPuntos = (puntos) => {
    const enPantalla = multiplicar(gs.ctm, aPantalla);
    for (const p of puntos) {
      const [x, y] = aplicar(enPantalla, p);
      trazado = trazado ? [Math.min(trazado[0], x), Math.min(trazado[1], y), Math.max(trazado[2], x), Math.max(trazado[3], y)] : [x, y, x, y];
    }
  };
  const terminarTrazado = () => {
    if (recortar && trazado) {
      const r = gs.recorte;
      gs.recorte = [Math.max(r[0], trazado[0]), Math.max(r[1], trazado[1]), Math.min(r[2], trazado[2]), Math.min(r[3], trazado[3])];
      gs.recorteExplicito = true;
    }
    trazado = null;
    recortar = false;
  };
  const fuentes = obtener(doc, recursos, "Font");
  const xobjects = obtener(doc, recursos, "XObject");

  // Se llama una vez por cada letra del documento: las cuentas se hacen a mano (sin crear matrices)
  // porque es lo que más tarda al leer un documento.
  const mostrar = (textoBytes, opIndice, piezaIndice) => {
    const fuente = gs.fuente;
    if (!fuente) return;
    const [m0, m1, m2, m3, m4, m5] = multiplicar(gs.ctm, aPantalla); // de texto a pantalla, fijo en el operador
    const { tamano: tf, th, ts, tc, tw } = gs;
    const asc = fuente.ascendente;
    const desc = fuente.descendente;
    const zona = gs.recorte;
    const explicito = gs.recorteExplicito;
    const color = colorARgb(gs.relleno);
    const relleno = gs.tr === 0 || gs.tr === 2 || gs.tr === 4 || gs.tr === 6;
    const editable = contexto.nivel === 0;
    const e = 1e-3;
    fuente.recorrerCodigos(textoBytes, (codigo, inicio, fin) => {
      const w0 = fuente.anchura(codigo);
      // Matriz de la letra en pantalla: [tf·th 0 0 tf 0 ts] × Tm × (CTM × pantalla)
      const g0 = tf * th * tm[0], g1 = tf * th * tm[1], g2 = tf * tm[2], g3 = tf * tm[3];
      const g4 = ts * tm[2] + tm[4], g5 = ts * tm[3] + tm[5];
      const a = g0 * m0 + g1 * m2, b = g0 * m1 + g1 * m3;
      const c = g2 * m0 + g3 * m2, d = g2 * m1 + g3 * m3;
      const x = g4 * m0 + g5 * m2 + m4, y = g4 * m1 + g5 * m3 + m5;
      // Caja de la letra: de su descendente a su ascendente y de 0 a su avance
      const ax = w0 * a, ay = w0 * b;
      const x1 = x + desc * c, y1 = y + desc * d;
      const x2 = x + asc * c, y2 = y + asc * d;
      const rect = [
        Math.min(x1, x2, x1 + ax, x2 + ax), Math.min(y1, y2, y1 + ay, y2 + ay),
        Math.max(x1, x2, x1 + ax, x2 + ax), Math.max(y1, y2, y1 + ay, y2 + ay),
      ];
      const unicode = fuente.unicode(codigo);
      // Lo que queda fuera de la zona visible no se lee. Un espacio no tiene forma: cuenta su punto
      // de origen, que dentro de un recorte tiene que quedar dentro (no en el borde).
      const fueraDePagina = unicode.trim() === ""
        ? explicito
          ? !(x > zona[0] + e && x < zona[2] - e && y > zona[1] + e && y < zona[3] - e)
          : x < zona[0] - e || x > zona[2] + e || y < zona[1] - e || y > zona[3] + e
        : rect[2] <= zona[0] || rect[0] >= zona[2] || rect[3] <= zona[1] || rect[1] >= zona[3];
      const espacioPalabra = fin - inicio === 1 && codigo === 32 ? tw : 0;
      const espaciado = w0 * tf + tc + espacioPalabra; // lo que avanza, en unidades de texto
      resultado.glifos.push({
        c: unicode,
        codigo,
        gid: fuente.gid(codigo),
        fuente,
        tamano: Math.sqrt(Math.abs(a * d - b * c)),
        origen: [x, y],
        rect,
        avance: w0,
        avancePantalla: [ax, ay],
        color,
        relleno,
        fueraDePagina,
        editable,
        op: opIndice,
        pieza: piezaIndice,
        bytesInicio: inicio,
        bytesFin: fin,
        tamanoFuente: tf,
        espaciado,
      });
      // Avanzar: Tm = [1 0 0 1 tx 0] × Tm
      const tx = espaciado * th;
      tm = [tm[0], tm[1], tm[2], tm[3], tx * tm[0] + tm[4], tx * tm[1] + tm[5]];
    });
  };

  ops.forEach((operacion, indice) => {
    const { op, operandos: o } = operacion;
    switch (op) {
      case "q":
        pila.push({ ...gs, relleno: [...gs.relleno] });
        break;
      case "Q":
        if (pila.length) gs = pila.pop();
        break;
      case "m":
      case "l":
        anadirPuntos([[num(o[0]), num(o[1])]]);
        break;
      case "c":
        anadirPuntos([[num(o[0]), num(o[1])], [num(o[2]), num(o[3])], [num(o[4]), num(o[5])]]);
        break;
      case "v":
      case "y":
        anadirPuntos([[num(o[0]), num(o[1])], [num(o[2]), num(o[3])]]);
        break;
      case "re": {
        const [x, y, w, h] = o.slice(0, 4).map(num);
        anadirPuntos([[x, y], [x + w, y], [x, y + h], [x + w, y + h]]);
        break;
      }
      case "W":
      case "W*":
        recortar = true;
        break;
      case "n":
      case "f":
      case "F":
      case "f*":
      case "S":
      case "s":
      case "B":
      case "B*":
      case "b":
      case "b*":
        terminarTrazado();
        break;
      case "cm":
        gs.ctm = multiplicar(o.slice(0, 6).map(num), gs.ctm);
        break;
      case "BT":
        tm = [...IDENTIDAD];
        tlm = [...IDENTIDAD];
        break;
      case "Tf": {
        const nombreFuente = o[0]?.valor;
        gs.fuente = fuenteDe(doc, obtener(doc, fuentes, nombreFuente));
        gs.tamano = num(o[1]);
        break;
      }
      case "Tc":
        gs.tc = num(o[0]);
        break;
      case "Tw":
        gs.tw = num(o[0]);
        break;
      case "Tz":
        gs.th = num(o[0]) / 100;
        break;
      case "TL":
        gs.tl = num(o[0]);
        break;
      case "Ts":
        gs.ts = num(o[0]);
        break;
      case "Tr":
        gs.tr = num(o[0]);
        break;
      case "Td":
        tlm = multiplicar([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
        tm = [...tlm];
        break;
      case "TD":
        gs.tl = -num(o[1]);
        tlm = multiplicar([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
        tm = [...tlm];
        break;
      case "Tm":
        tlm = o.slice(0, 6).map(num);
        tm = [...tlm];
        break;
      case "T*":
        tlm = multiplicar([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = [...tlm];
        break;
      case "Tj":
        if (o[0]?.tipo === "texto") mostrar(o[0].valor, indice, 0);
        break;
      case "'":
        tlm = multiplicar([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = [...tlm];
        if (o[0]?.tipo === "texto") mostrar(o[0].valor, indice, 0);
        break;
      case '"':
        gs.tw = num(o[0]);
        gs.tc = num(o[1]);
        tlm = multiplicar([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = [...tlm];
        if (o[2]?.tipo === "texto") mostrar(o[2].valor, indice, 2);
        break;
      case "TJ":
        if (o[0]?.tipo === "array") {
          o[0].valor.forEach((pieza, k) => {
            if (pieza.tipo === "texto") mostrar(pieza.valor, indice, k);
            else if (pieza.tipo === "numero" && gs.fuente) {
              const tx = (-pieza.valor / 1000) * gs.tamano * gs.th;
              tm = multiplicar([1, 0, 0, 1, tx, 0], tm);
            }
          });
        }
        break;
      case "g":
        gs.espacioRelleno = 1;
        gs.relleno = [num(o[0])];
        break;
      case "rg":
        gs.espacioRelleno = 3;
        gs.relleno = o.slice(0, 3).map(num);
        break;
      case "k":
        gs.espacioRelleno = 4;
        gs.relleno = o.slice(0, 4).map(num);
        break;
      case "cs":
        gs.espacioRelleno = componentesDeEspacio(doc, recursos, o[0]?.valor);
        gs.relleno = gs.espacioRelleno === 4 ? [0, 0, 0, 1] : new Array(gs.espacioRelleno).fill(0);
        break;
      case "sc":
      case "scn": {
        const valores = o.filter((x) => x.tipo === "numero").map(num);
        if (valores.length) gs.relleno = valores;
        break;
      }
      case "Do": {
        const objeto = obtener(doc, xobjects, o[0]?.valor);
        if (!(objeto instanceof PDFStream)) break;
        const subtipo = comoNombre(obtener(doc, objeto, "Subtype"));
        if (subtipo === "Image") {
          const enPantalla = multiplicar(gs.ctm, aPantalla);
          resultado.imagenes.push({ rect: transformarRect(enPantalla, [0, 0, 1, 1]), objeto, nombre: o[0].valor, ctm: gs.ctm, recursos });
        } else if (subtipo === "Form") {
          ejecutarForm(doc, objeto, IDENTIDAD, gs.ctm, recursos, { ...contexto, recorte: gs.recorte, recorteExplicito: gs.recorteExplicito });
        }
        break;
      }
      case "BI": {
        const enPantalla = multiplicar(gs.ctm, aPantalla);
        resultado.imagenes.push({ rect: transformarRect(enPantalla, [0, 0, 1, 1]), objeto: null, incrustada: true, ctm: gs.ctm, recursos });
        break;
      }
      default:
        break;
    }
  });
}

// ---------------------------------------------------------------- líneas y texto

// Constantes para agrupar letras en líneas, como hacen los lectores de PDF habituales
const DISTANCIA_ESPACIO = 0.15; // hueco (en tamaños de letra) a partir del cual hay un espacio
const DISTANCIA_MAXIMA = 0.8; // hueco a partir del cual se considera otra línea (otra columna)
const RETROCESO_MAXIMO = 0.5; // retroceso que aún se considera la misma línea (letras que se solapan)
const DESVIO_LINEA_BASE = 0.8; // desvío de la línea base que aún se considera la misma línea

/**
 * Líneas de texto: [{ bbox, chars: [{ c, origen, rect, fuente, tamano, color, glifo }] }].
 * Se añaden espacios donde hay hueco entre letras aunque el PDF no los tenga.
 */
export function lineasDeGlifos(glifos) {
  const lineas = [];
  let linea = null;
  let pluma = null;
  let direccion = null;
  for (const glifo of glifos) {
    if (glifo.fueraDePagina) continue;
    const letras = [...glifo.c];
    if (!letras.length) continue;
    const [ax, ay] = glifo.avancePantalla;
    const largo = Math.hypot(ax, ay) || 1;
    const dir = [ax / largo, ay / largo];
    const tamano = glifo.tamano || 1;
    let nueva = !linea || !direccion || dir[0] * direccion[0] + dir[1] * direccion[1] < 0.999;
    let espacio = false;
    if (!nueva) {
      const dx = glifo.origen[0] - pluma[0];
      const dy = glifo.origen[1] - pluma[1];
      const desvio = -dir[1] * dx + dir[0] * dy;
      const avance = dir[0] * dx + dir[1] * dy;
      if (Math.abs(desvio) >= tamano * DESVIO_LINEA_BASE) nueva = true;
      else if (avance > -tamano * RETROCESO_MAXIMO && avance < tamano * DISTANCIA_ESPACIO) nueva = false;
      else if (avance > 0 && avance < tamano * DISTANCIA_MAXIMA) espacio = true;
      else nueva = true;
    }
    if (nueva) {
      linea = { bbox: null, chars: [] };
      lineas.push(linea);
      direccion = dir;
    } else if (espacio && letras[0] !== " " && linea.chars.at(-1)?.c !== " ") {
      const anterior = linea.chars.at(-1);
      const rect = [anterior.rect[2], anterior.rect[1], glifo.rect[0], anterior.rect[3]];
      linea.chars.push({ c: " ", origen: [...pluma], rect, fuente: glifo.fuente.nombre, tamano, color: glifo.color, glifo: null, sintetico: true });
    }
    // Una ligadura ("fi") se reparte en varias letras que comparten la caja
    const ancho = (glifo.rect[2] - glifo.rect[0]) / letras.length;
    letras.forEach((letra, k) => {
      const rect = letras.length === 1 ? glifo.rect : [glifo.rect[0] + ancho * k, glifo.rect[1], glifo.rect[0] + ancho * (k + 1), glifo.rect[3]];
      linea.chars.push({ c: letra, origen: glifo.origen, rect, fuente: glifo.fuente.nombre, tamano, color: glifo.color, glifo });
    });
    const r = glifo.rect;
    linea.bbox = linea.bbox ? [Math.min(linea.bbox[0], r[0]), Math.min(linea.bbox[1], r[1]), Math.max(linea.bbox[2], r[2]), Math.max(linea.bbox[3], r[3])] : [...r];
    pluma = [glifo.origen[0] + ax, glifo.origen[1] + ay];
  }
  return lineas;
}

/** Texto de la página: las líneas separadas por saltos de línea. */
export function textoDeLineas(lineas) {
  return lineas.map((l) => l.chars.map((ch) => ch.c).join("")).join("\n");
}
