// © 2026 Adrián Barroso de Cabo.
// Coge una fuente TrueType entera y devuelve otra con los dibujos de solo las letras que se le
// pidan. Se usa al preparar la plantilla de MACADAMIA (scripts/plantilla-macadamia.mjs).
//
// POR QUÉ HACE FALTA
// Word, al guardar un PDF, mete la fuente entera pero le borra los dibujos de las letras que el
// documento no usa. En el documento de MACADAMIA el nombre del trabajador va en negrita, así que
// de la Calibri negrita solo quedan las letras del nombre del ejemplo: con otro trabajador
// faltaría medio abecedario. La solución es coger la Calibri de verdad (la de C:\Windows\Fonts) y
// dejar dentro de la plantilla una copia con todas las letras que hagan falta.
//
// CÓMO ESTÁ HECHA UNA FUENTE TRUETYPE, EN CUATRO LÍNEAS
// Es una lista de tablas con nombre de cuatro letras. Las que importan aquí son "glyf" (los
// dibujos de las letras, uno detrás de otro), "loca" (en qué byte de "glyf" empieza cada dibujo) y
// "cmap" (qué dibujo le toca a cada letra). Recortar consiste en dejar "glyf" solo con los dibujos
// que se quieren y rehacer "loca"; los demás dibujos se quedan vacíos, que es justo lo que hace
// Word. Todo lo demás (anchuras, cmap, nombres) se copia tal cual, así que las letras siguen
// midiendo y llamándose igual.

// Las tablas que se conservan: las obligatorias de una TrueType más las que hacen falta para que
// las letras se dibujen bien a tamaños pequeños (cvt, fpgm, prep, gasp).
const NECESARIAS = new Set(["head", "hhea", "maxp", "OS/2", "hmtx", "cmap", "post", "name", "cvt ", "fpgm", "prep", "gasp"]);

/** Lee la lista de tablas de la fuente. */
function tablasDe(vista) {
  const tablas = new Map();
  const cuantas = vista.getUint16(4);
  for (let i = 0; i < cuantas; i++) {
    const p = 12 + i * 16;
    const etiqueta = String.fromCharCode(vista.getUint8(p), vista.getUint8(p + 1), vista.getUint8(p + 2), vista.getUint8(p + 3));
    tablas.set(etiqueta, { inicio: vista.getUint32(p + 8), largo: vista.getUint32(p + 12) });
  }
  return tablas;
}

/** El número de dibujo que le corresponde a una letra, según la tabla cmap (formato 4). */
function buscarCmap(vista, tablas) {
  const cmap = tablas.get("cmap").inicio;
  let mejor = null;
  for (let i = 0; i < vista.getUint16(cmap + 2); i++) {
    const p = cmap + 4 + i * 8;
    const plataforma = vista.getUint16(p);
    const codificacion = vista.getUint16(p + 2);
    const tabla = cmap + vista.getUint32(p + 4);
    if (vista.getUint16(tabla) !== 4) continue;
    if ((plataforma === 3 && (codificacion === 1 || codificacion === 0)) || plataforma === 0) mejor = tabla;
  }
  if (mejor === null) throw new Error("la fuente no trae una tabla cmap del formato esperado");
  return (codigo) => {
    const segX2 = vista.getUint16(mejor + 6);
    const fin = mejor + 14;
    const ini = fin + segX2 + 2;
    const delta = ini + segX2;
    const rango = delta + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      if (codigo > vista.getUint16(fin + s * 2)) continue;
      if (codigo < vista.getUint16(ini + s * 2)) return 0;
      const r = vista.getUint16(rango + s * 2);
      if (!r) return (codigo + vista.getInt16(delta + s * 2)) & 0xffff;
      const g = vista.getUint16(rango + s * 2 + r + (codigo - vista.getUint16(ini + s * 2)) * 2);
      return g ? (g + vista.getInt16(delta + s * 2)) & 0xffff : 0;
    }
    return 0;
  };
}

/**
 * La fuente recortada, en bytes, con los dibujos de las letras de `letras` (y los de las piezas que
 * usen: las letras con tilde se dibujan juntando la letra y el acento). Devuelve también, para cada
 * letra, su anchura en milésimas, que es lo que hay que escribir en la tabla /Widths del PDF.
 */
export function recortarFuente(bytes, letras) {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tablas = tablasDe(vista);
  const head = tablas.get("head").inicio;
  const unidades = vista.getUint16(head + 18);
  const formatoLoca = vista.getInt16(head + 50);
  const numGlifos = vista.getUint16(tablas.get("maxp").inicio + 4);
  const glifoDe = buscarCmap(vista, tablas);

  const loca = tablas.get("loca").inicio;
  const glyf = tablas.get("glyf").inicio;
  const desplazamiento = (i) => (formatoLoca ? vista.getUint32(loca + i * 4) : vista.getUint16(loca + i * 2) * 2);

  // Qué dibujos hay que conservar: los de las letras pedidas, el 0 (el cuadrito de "esta letra no
  // existe") y, si una letra es compuesta, también los de sus piezas.
  const necesarios = new Set([0]);
  const pendientes = [];
  const anchuras = new Map();
  const hmtx = tablas.get("hmtx").inicio;
  const numAnchuras = vista.getUint16(tablas.get("hhea").inicio + 34);
  for (const letra of letras) {
    const g = glifoDe(letra.codePointAt(0));
    if (!g) continue;
    necesarios.add(g);
    pendientes.push(g);
    const indice = Math.min(g, numAnchuras - 1);
    anchuras.set(letra, Math.round((vista.getUint16(hmtx + indice * 4) * 1000) / unidades));
  }
  while (pendientes.length) {
    const g = pendientes.pop();
    const inicio = glyf + desplazamiento(g);
    if (desplazamiento(g + 1) <= desplazamiento(g)) continue;
    if (vista.getInt16(inicio) >= 0) continue; // dibujo sencillo: no usa piezas
    let p = inicio + 10;
    for (;;) {
      const banderas = vista.getUint16(p);
      const pieza = vista.getUint16(p + 2);
      if (!necesarios.has(pieza)) {
        necesarios.add(pieza);
        pendientes.push(pieza);
      }
      p += 4 + (banderas & 1 ? 4 : 2);
      if (banderas & 8) p += 2;
      else if (banderas & 64) p += 4;
      else if (banderas & 128) p += 8;
      if (!(banderas & 32)) break;
    }
  }

  // "glyf" nuevo: los dibujos que se conservan, uno detrás de otro; los demás, vacíos.
  const trozos = [];
  const desplazamientosNuevos = [0];
  let total = 0;
  for (let g = 0; g < numGlifos; g++) {
    if (necesarios.has(g)) {
      const desde = desplazamiento(g);
      const hasta = desplazamiento(g + 1);
      const largo = Math.ceil((hasta - desde) / 4) * 4; // los dibujos van de cuatro en cuatro bytes
      const trozo = new Uint8Array(largo);
      trozo.set(bytes.subarray(glyf + desde, glyf + hasta));
      trozos.push(trozo);
      total += largo;
    }
    desplazamientosNuevos.push(total);
  }
  const glyfNuevo = new Uint8Array(total);
  let i = 0;
  for (const trozo of trozos) {
    glyfNuevo.set(trozo, i);
    i += trozo.length;
  }

  // "loca" nuevo, en el mismo formato que traía la fuente.
  const grande = formatoLoca === 1 || total > 0x1fffe;
  const locaNuevo = new Uint8Array((numGlifos + 1) * (grande ? 4 : 2));
  const vistaLoca = new DataView(locaNuevo.buffer);
  desplazamientosNuevos.forEach((d, g) => {
    if (grande) vistaLoca.setUint32(g * 4, d);
    else vistaLoca.setUint16(g * 2, d / 2);
  });

  // Se rehace la fuente cambiando glyf y loca (y el formato de loca en head). De las demás tablas
  // se guardan solo las que hacen falta para dibujar y medir: las de ligaduras y espaciados finos
  // (GPOS, GSUB, kern…) no se usan aquí y ocupan medio megabyte entre todas.
  const salida = new Map();
  for (const [etiqueta, { inicio, largo }] of tablas) {
    if (etiqueta === "glyf") salida.set(etiqueta, glyfNuevo);
    else if (etiqueta === "loca") salida.set(etiqueta, locaNuevo);
    else if (NECESARIAS.has(etiqueta)) salida.set(etiqueta, bytes.slice(inicio, inicio + largo));
  }
  new DataView(salida.get("head").buffer, salida.get("head").byteOffset).setInt16(50, grande ? 1 : 0);

  return { fuente: montar(salida), anchuras };
}

/** Junta las tablas en un archivo de fuente, con su índice delante. */
function montar(tablas) {
  const etiquetas = [...tablas.keys()].sort();
  const cabecera = 12 + etiquetas.length * 16;
  const alineado = (n) => Math.ceil(n / 4) * 4;
  let total = cabecera;
  const inicios = new Map();
  for (const etiqueta of etiquetas) {
    inicios.set(etiqueta, total);
    total += alineado(tablas.get(etiqueta).length);
  }

  const salida = new Uint8Array(total);
  const vista = new DataView(salida.buffer);
  vista.setUint32(0, 0x00010000); // fuente con dibujos TrueType
  vista.setUint16(4, etiquetas.length);
  // Los tres números siguientes son una ayuda para buscar tablas deprisa; se calculan así.
  const potencia = 2 ** Math.floor(Math.log2(etiquetas.length));
  vista.setUint16(6, potencia * 16);
  vista.setUint16(8, Math.log2(potencia));
  vista.setUint16(10, (etiquetas.length - potencia) * 16);

  etiquetas.forEach((etiqueta, i) => {
    const p = 12 + i * 16;
    for (let c = 0; c < 4; c++) vista.setUint8(p + c, etiqueta.charCodeAt(c));
    vista.setUint32(p + 4, suma(tablas.get(etiqueta)));
    vista.setUint32(p + 8, inicios.get(etiqueta));
    vista.setUint32(p + 12, tablas.get(etiqueta).length);
    salida.set(tablas.get(etiqueta), inicios.get(etiqueta));
  });
  return salida;
}

/** La suma de comprobación de una tabla: sus bytes sumados de cuatro en cuatro. */
function suma(bytes) {
  let total = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const b = (n) => bytes[i + n] ?? 0; // la última tabla puede no llegar a cuatro bytes
    total = (total + (((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0)) >>> 0;
  }
  return total;
}
