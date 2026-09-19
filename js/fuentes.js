// © 2026 Adrián Barroso de Cabo.
// Fuentes de un PDF: qué carácter es cada código, qué glifo usa, cuánto avanza y qué altura tiene.
// Lo necesita el lector de texto (lector.js) para saber dónde está cada letra, y el cambio de
// fecha para escribir con los glifos del propio documento.

import { StandardFontEmbedder } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { comoArray, comoNombre, comoNumero, leerStream, nombreBase, obtener, PDFDict, PDFName, PDFStream, resolver } from "./pdfbase.js";

const cache = new WeakMap(); // diccionario de fuente -> Fuente

/** La fuente de un diccionario /Font (se reutiliza si ya se ha leído). */
export function fuenteDe(doc, dict) {
  if (!(dict instanceof PDFDict)) return FUENTE_VACIA;
  if (!cache.has(dict)) {
    let fuente;
    try {
      fuente = new Fuente(doc, dict);
    } catch {
      fuente = FUENTE_VACIA;
    }
    cache.set(dict, fuente);
  }
  return cache.get(dict);
}

class Fuente {
  constructor(doc, dict) {
    this.dict = dict;
    this.subtipo = comoNombre(obtener(doc, dict, "Subtype")) ?? "Type1";
    this.nombre = comoNombre(obtener(doc, dict, "BaseFont")) ?? "";
    this.nombreBase = nombreBase(this.nombre);
    this.tipo3 = this.subtipo === "Type3";
    this.matrizType3 = this.tipo3 ? (comoArray(doc, obtener(doc, dict, "FontMatrix"))?.map(comoNumero) ?? [0.001, 0, 0, 0.001, 0, 0]) : null;

    if (this.subtipo === "Type0") this.#leerCompuesta(doc, dict);
    else this.#leerSimple(doc, dict);

    const aUnicode = obtener(doc, dict, "ToUnicode");
    this.aUnicode = aUnicode instanceof PDFStream ? leerCMap(leerStream(aUnicode)).unicode : null;
    this.#leerAlturas(doc);
  }

  // ------------------------------------------------ compuestas (Type0)
  #leerCompuesta(doc, dict) {
    this.compuesta = true;
    const codificacion = obtener(doc, dict, "Encoding");
    const nombreCodificacion = comoNombre(codificacion);
    this.identityH = nombreCodificacion === "Identity-H";
    this.vertical = nombreCodificacion === "Identity-V" || /-V$/.test(nombreCodificacion ?? "");
    if (codificacion instanceof PDFStream) {
      const cmap = leerCMap(leerStream(codificacion));
      this.rangos = cmap.rangos.length ? cmap.rangos : RANGOS_DOS_BYTES;
      this.aCid = cmap.cid;
    } else {
      this.rangos = RANGOS_DOS_BYTES; // Identity-H/V y las CMaps predefinidas usan casi siempre 2 bytes
      this.aCid = null;
    }

    const descendiente = resolver(doc, comoArray(doc, obtener(doc, dict, "DescendantFonts"))?.[0]);
    this.descendiente = descendiente instanceof PDFDict ? descendiente : null;
    this.descriptor = obtener(doc, this.descendiente, "FontDescriptor");
    this.anchuraDefecto = comoNumero(obtener(doc, this.descendiente, "DW")) ?? 1000;
    this.anchuras = new Map();
    const w = comoArray(doc, obtener(doc, this.descendiente, "W")) ?? [];
    for (let i = 0; i < w.length; ) {
      const primero = comoNumero(w[i]);
      const siguiente = resolver(doc, w[i + 1]);
      if (primero === undefined) break;
      if (siguiente && typeof siguiente.asArray === "function") {
        siguiente.asArray().forEach((valor, k) => this.anchuras.set(primero + k, comoNumero(resolver(doc, valor)) ?? 0));
        i += 2;
      } else {
        const ultimo = comoNumero(siguiente);
        const anchura = comoNumero(w[i + 2]) ?? 0;
        for (let c = primero; c <= ultimo && c - primero < 65536; c++) this.anchuras.set(c, anchura);
        i += 3;
      }
    }
    const mapaGid = obtener(doc, this.descendiente, "CIDToGIDMap");
    this.cidAGidIdentidad = !(mapaGid instanceof PDFStream);
    this.cidAGid = mapaGid instanceof PDFStream ? leerStream(mapaGid) : null;
  }

  // ------------------------------------------------ simples (Type1, TrueType, Type3)
  #leerSimple(doc, dict) {
    this.compuesta = false;
    this.rangos = RANGOS_UN_BYTE;
    this.descriptor = obtener(doc, dict, "FontDescriptor");
    const primero = comoNumero(obtener(doc, dict, "FirstChar")) ?? 0;
    const anchuras = comoArray(doc, obtener(doc, dict, "Widths"));
    this.anchuras = new Map();
    anchuras?.forEach((valor, i) => this.anchuras.set(primero + i, comoNumero(valor) ?? 0));
    this.anchuraDefecto = comoNumero(obtener(doc, this.descriptor, "MissingWidth")) ?? 0;

    // Codificación: la base (WinAnsi, MacRoman, Standard) más las diferencias con nombres de glifo
    const codificacion = obtener(doc, dict, "Encoding");
    let base = comoNombre(codificacion);
    const diferencias = new Map();
    if (codificacion instanceof PDFDict) {
      base = comoNombre(obtener(doc, codificacion, "BaseEncoding"));
      let codigo = 0;
      for (const valor of comoArray(doc, obtener(doc, codificacion, "Differences")) ?? []) {
        const n = comoNumero(valor);
        if (n !== undefined) codigo = n;
        else if (valor instanceof PDFName) diferencias.set(codigo++, comoNombre(valor));
      }
    }
    const estandar = STANDARD_14[this.nombreBase];
    const simbolica = this.nombreBase.startsWith("Symbol") || this.nombreBase.startsWith("ZapfDingbats");
    const tabla = base === "WinAnsiEncoding" ? WIN_ANSI : base === "MacRomanEncoding" ? MAC_ROMAN : base === "StandardEncoding" ? STANDARD : null;
    this.unicodeSimple = new Map();
    this.nombreGlifo = new Map();
    for (let codigo = 0; codigo < 256; codigo++) {
      const nombreDiferencia = diferencias.get(codigo);
      let unicode = nombreDiferencia ? unicodeDeNombre(nombreDiferencia) : null;
      if (!unicode && !nombreDiferencia) {
        if (tabla) unicode = tabla(codigo);
        else if (!simbolica) unicode = (this.subtipo === "TrueType" ? WIN_ANSI : STANDARD)(codigo);
      }
      if (unicode) this.unicodeSimple.set(codigo, unicode);
      if (nombreDiferencia) this.nombreGlifo.set(codigo, nombreDiferencia);
    }
    // Las 14 estándar sin /Widths: sus anchuras son conocidas
    if (!anchuras && estandar) {
      const embebedora = StandardFontEmbedder.for(estandar);
      for (const [codigo, unicode] of this.unicodeSimple) {
        try {
          this.anchuras.set(codigo, embebedora.widthOfTextAtSize(unicode, 1000));
        } catch {
          // carácter que esa fuente no tiene
        }
      }
    }
  }

  #leerAlturas(doc) {
    const ascenso = comoNumero(obtener(doc, this.descriptor, "Ascent"));
    const descenso = comoNumero(obtener(doc, this.descriptor, "Descent"));
    this.ascendente = ascenso ? ascenso / 1000 : 0.8;
    this.descendente = descenso ? descenso / 1000 : -0.2;
    if (this.ascendente - this.descendente < 0.01) {
      this.ascendente = 0.9;
      this.descendente = -0.1;
    }
  }

  /** Llama a `accion(codigo, inicio, fin)` por cada código del texto (rápido en los casos habituales). */
  recorrerCodigos(bytes, accion) {
    if (this.rangos === RANGOS_UN_BYTE) {
      for (let i = 0; i < bytes.length; i++) accion(bytes[i], i, i + 1);
    } else if (this.rangos === RANGOS_DOS_BYTES) {
      for (let i = 0; i + 1 < bytes.length; i += 2) accion(bytes[i] * 256 + bytes[i + 1], i, i + 2);
    } else {
      for (const { codigo, inicio, fin } of this.codigos(bytes)) accion(codigo, inicio, fin);
    }
  }

  /** Recorre los códigos de un texto: [{ codigo, bytes }]. */
  codigos(bytes) {
    const lista = [];
    for (let i = 0; i < bytes.length; ) {
      let tomado = null;
      for (const { longitud, desde, hasta } of this.rangos) {
        if (i + longitud > bytes.length) continue;
        let codigo = 0;
        for (let k = 0; k < longitud; k++) codigo = codigo * 256 + bytes[i + k];
        if (codigo >= desde && codigo <= hasta) {
          tomado = { codigo, longitud };
          break;
        }
      }
      if (!tomado) {
        const longitud = Math.min(this.rangos[0]?.longitud ?? 1, bytes.length - i);
        let codigo = 0;
        for (let k = 0; k < longitud; k++) codigo = codigo * 256 + bytes[i + k];
        tomado = { codigo, longitud };
      }
      lista.push({ codigo: tomado.codigo, inicio: i, fin: i + tomado.longitud });
      i += tomado.longitud;
    }
    return lista;
  }

  cid(codigo) {
    if (!this.compuesta) return codigo;
    return this.aCid?.get(codigo) ?? codigo;
  }

  /** Número de glifo dentro de la fuente incrustada (solo en las compuestas). */
  gid(codigo) {
    if (!this.compuesta) return codigo;
    const cid = this.cid(codigo);
    if (this.cidAGidIdentidad) return cid;
    const i = cid * 2;
    return i + 1 < this.cidAGid.length ? this.cidAGid[i] * 256 + this.cidAGid[i + 1] : 0;
  }

  /** Avance del glifo en unidades de texto (milésimas de la letra / 1000). */
  anchura(codigo) {
    const clave = this.compuesta ? this.cid(codigo) : codigo;
    const valor = this.anchuras.get(clave) ?? this.anchuraDefecto;
    return this.tipo3 ? valor * this.matrizType3[0] : valor / 1000;
  }

  unicode(codigo) {
    const propio = this.aUnicode?.get(codigo);
    if (propio !== undefined) return propio;
    if (!this.compuesta) return this.unicodeSimple.get(codigo) ?? (codigo >= 32 && codigo < 127 ? String.fromCharCode(codigo) : "�");
    return "�";
  }
}

const FUENTE_VACIA = Object.freeze({
  nombre: "",
  nombreBase: "",
  compuesta: false,
  ascendente: 0.8,
  descendente: -0.2,
  codigos: (bytes) => [...bytes].map((codigo, i) => ({ codigo, inicio: i, fin: i + 1 })),
  recorrerCodigos: (bytes, accion) => bytes.forEach((codigo, i) => accion(codigo, i, i + 1)),
  gid: (codigo) => codigo,
  cid: (codigo) => codigo,
  anchura: () => 0.5,
  unicode: (codigo) => (codigo >= 32 && codigo < 127 ? String.fromCharCode(codigo) : "�"),
});

const RANGOS_DOS_BYTES = [{ longitud: 2, desde: 0, hasta: 0xffff }];
const RANGOS_UN_BYTE = [{ longitud: 1, desde: 0, hasta: 0xff }];

// ---------------------------------------------------------------- CMaps

/** Lee una CMap (ToUnicode o de codificación): rangos de códigos, código -> texto y código -> CID. */
export function leerCMap(bytes) {
  const texto = new TextDecoder("latin1").decode(bytes);
  const rangos = [];
  const unicode = new Map();
  const cid = new Map();
  const hex = (h) => h.replace(/\s+/g, "");
  const valorHex = (h) => parseInt(hex(h) || "0", 16);
  const textoDeHex = (h) => {
    const limpio = hex(h);
    const unidades = [];
    for (let i = 0; i + 4 <= limpio.length; i += 4) unidades.push(parseInt(limpio.slice(i, i + 4), 16));
    if (limpio.length % 4 === 2) unidades.push(parseInt(limpio.slice(-2), 16));
    return String.fromCharCode(...unidades);
  };
  const secciones = (inicio, fin) => {
    const re = new RegExp(`${inicio}([\\s\\S]*?)${fin}`, "g");
    return [...texto.matchAll(re)].map((m) => m[1]);
  };
  for (const s of secciones("begincodespacerange", "endcodespacerange")) {
    for (const m of s.matchAll(/<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>/g)) {
      rangos.push({ longitud: Math.max(1, Math.ceil(hex(m[1]).length / 2)), desde: valorHex(m[1]), hasta: valorHex(m[2]) });
    }
  }
  rangos.sort((a, b) => a.longitud - b.longitud);
  for (const s of secciones("beginbfchar", "endbfchar")) {
    for (const m of s.matchAll(/<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>/g)) unicode.set(valorHex(m[1]), textoDeHex(m[2]));
  }
  for (const s of secciones("beginbfrange", "endbfrange")) {
    for (const m of s.matchAll(/<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(<[0-9a-fA-F\s]*>|\[[^\]]*\])/g)) {
      const desde = valorHex(m[1]);
      const hasta = valorHex(m[2]);
      if (hasta - desde > 65535) continue;
      if (m[3].startsWith("[")) {
        [...m[3].matchAll(/<([0-9a-fA-F\s]*)>/g)].forEach((d, k) => unicode.set(desde + k, textoDeHex(d[1])));
      } else {
        const destino = hex(m[3].slice(1, -1));
        const cabeza = destino.slice(0, -4);
        const ultimo = parseInt(destino.slice(-4) || "0", 16);
        for (let c = desde; c <= hasta; c++) unicode.set(c, textoDeHex(cabeza + (ultimo + c - desde).toString(16).padStart(4, "0")));
      }
    }
  }
  for (const s of secciones("begincidchar", "endcidchar")) {
    for (const m of s.matchAll(/<([0-9a-fA-F\s]*)>\s*(\d+)/g)) cid.set(valorHex(m[1]), Number(m[2]));
  }
  for (const s of secciones("begincidrange", "endcidrange")) {
    for (const m of s.matchAll(/<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(\d+)/g)) {
      const desde = valorHex(m[1]);
      const hasta = valorHex(m[2]);
      for (let c = desde; c <= hasta && c - desde < 65536; c++) cid.set(c, Number(m[3]) + c - desde);
    }
  }
  return { rangos, unicode, cid: cid.size ? cid : null };
}

// ---------------------------------------------------------------- codificaciones simples

const STANDARD_14 = {
  Helvetica: "Helvetica", "Helvetica-Bold": "Helvetica-Bold", "Helvetica-Oblique": "Helvetica-Oblique",
  "Helvetica-BoldOblique": "Helvetica-BoldOblique", "Times-Roman": "Times-Roman", "Times-Bold": "Times-Bold",
  "Times-Italic": "Times-Italic", "Times-BoldItalic": "Times-BoldItalic", Courier: "Courier",
  "Courier-Bold": "Courier-Bold", "Courier-Oblique": "Courier-Oblique", "Courier-BoldOblique": "Courier-BoldOblique",
  Arial: "Helvetica", "Arial-BoldMT": "Helvetica-Bold", ArialMT: "Helvetica",
};

const WIN_ANSI_80 = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ";

function WIN_ANSI(codigo) {
  if (codigo >= 32 && codigo < 127) return String.fromCharCode(codigo);
  if (codigo >= 0x80 && codigo < 0xa0) {
    const c = WIN_ANSI_80[codigo - 0x80];
    return c === "�" ? null : c;
  }
  if (codigo >= 0xa0) return String.fromCharCode(codigo);
  return null;
}

const MAC_ROMAN_80 =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

function MAC_ROMAN(codigo) {
  if (codigo >= 32 && codigo < 127) return String.fromCharCode(codigo);
  if (codigo >= 0x80) return MAC_ROMAN_80[codigo - 0x80] ?? null;
  return null;
}

// StandardEncoding: igual que ASCII salvo las comillas y los caracteres altos
const STANDARD_ALTOS = {
  0x27: "’", 0x60: "‘", 0xa1: "¡", 0xa2: "¢", 0xa3: "£", 0xa4: "⁄", 0xa5: "¥", 0xa6: "ƒ", 0xa7: "§", 0xa8: "¤",
  0xa9: "'", 0xaa: "“", 0xab: "«", 0xac: "‹", 0xad: "›", 0xae: "ﬁ", 0xaf: "ﬂ", 0xb1: "–", 0xb2: "†", 0xb3: "‡",
  0xb4: "·", 0xb6: "¶", 0xb7: "•", 0xb8: "‚", 0xb9: "„", 0xba: "”", 0xbb: "»", 0xbc: "…", 0xbd: "‰", 0xbf: "¿",
  0xc1: "`", 0xc2: "´", 0xc3: "ˆ", 0xc4: "˜", 0xc5: "¯", 0xc6: "˘", 0xc7: "˙", 0xc8: "¨", 0xca: "˚", 0xcb: "¸",
  0xcd: "˝", 0xce: "˛", 0xcf: "ˇ", 0xd0: "—", 0xe1: "Æ", 0xe3: "ª", 0xe8: "Ł", 0xe9: "Ø", 0xea: "Œ", 0xeb: "º",
  0xf1: "æ", 0xf5: "ı", 0xf8: "ł", 0xf9: "ø", 0xfa: "œ", 0xfb: "ß",
};

function STANDARD(codigo) {
  if (STANDARD_ALTOS[codigo]) return STANDARD_ALTOS[codigo];
  if (codigo >= 32 && codigo < 127) return String.fromCharCode(codigo);
  return null;
}

// Nombres de glifo habituales (lista de Adobe) que no se deducen de su forma "uniXXXX"
const NOMBRES = {
  space: " ", exclam: "!", quotedbl: "\"", numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*", plus: "+",
  comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3",
  four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<",
  equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]",
  asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~",
  exclamdown: "¡", cent: "¢", sterling: "£", currency: "¤", yen: "¥", brokenbar: "¦", section: "§",
  dieresis: "¨", copyright: "©", ordfeminine: "ª", guillemotleft: "«", logicalnot: "¬", registered: "®",
  macron: "¯", degree: "°", plusminus: "±", twosuperior: "²", threesuperior: "³", acute: "´", mu: "µ",
  paragraph: "¶", periodcentered: "·", cedilla: "¸", onesuperior: "¹", ordmasculine: "º",
  guillemotright: "»", onequarter: "¼", onehalf: "½", threequarters: "¾", questiondown: "¿",
  Agrave: "À", Aacute: "Á", Acircumflex: "Â", Atilde: "Ã", Adieresis: "Ä", Aring: "Å", AE: "Æ",
  Ccedilla: "Ç", Egrave: "È", Eacute: "É", Ecircumflex: "Ê", Edieresis: "Ë", Igrave: "Ì", Iacute: "Í",
  Icircumflex: "Î", Idieresis: "Ï", Eth: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocircumflex: "Ô",
  Otilde: "Õ", Odieresis: "Ö", multiply: "×", Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucircumflex: "Û",
  Udieresis: "Ü", Yacute: "Ý", Thorn: "Þ", germandbls: "ß", agrave: "à", aacute: "á", acircumflex: "â",
  atilde: "ã", adieresis: "ä", aring: "å", ae: "æ", ccedilla: "ç", egrave: "è", eacute: "é",
  ecircumflex: "ê", edieresis: "ë", igrave: "ì", iacute: "í", icircumflex: "î", idieresis: "ï", eth: "ð",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocircumflex: "ô", otilde: "õ", odieresis: "ö", divide: "÷",
  oslash: "ø", ugrave: "ù", uacute: "ú", ucircumflex: "û", udieresis: "ü", yacute: "ý", thorn: "þ",
  ydieresis: "ÿ", bullet: "•", ellipsis: "…", endash: "–", emdash: "—", quotedblleft: "“",
  quotedblright: "”", quotesinglbase: "‚", quotedblbase: "„", dagger: "†", daggerdbl: "‡", perthousand: "‰",
  Euro: "€", trademark: "™", fi: "ﬁ", fl: "ﬂ", florin: "ƒ", circumflex: "ˆ", tilde: "˜", dotlessi: "ı",
  OE: "Œ", oe: "œ", Scaron: "Š", scaron: "š", Zcaron: "Ž", zcaron: "ž", Ydieresis: "Ÿ", fraction: "⁄",
  guilsinglleft: "‹", guilsinglright: "›", nbspace: " ", sfthyphen: "­",
};

function unicodeDeNombre(nombreGlifo) {
  const base = nombreGlifo.split(".")[0];
  if (NOMBRES[base]) return NOMBRES[base];
  if (/^[A-Za-z]$/.test(base)) return base;
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(base);
  if (m) {
    const partes = base.slice(3).match(/.{4}/g);
    return String.fromCharCode(...partes.map((h) => parseInt(h, 16)));
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  return null;
}
