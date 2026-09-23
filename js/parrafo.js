// © 2026 Adrián Barroso de Cabo.
// Componer párrafos dentro de un PDF usando las letras del propio documento.
//
// Estas funciones son las que hacen que un texto cambiado a mano no se note: miden cada letra con
// la fuente que ya trae el PDF, reparten las palabras en líneas justificadas y las dibujan
// pidiéndole a esa misma fuente sus glifos. Las usan tanto el TA2 de la Seguridad Social
// (js/ta2.js) como el documento de MACADAMIA (js/macadamia.js), que son los dos impresos en los
// que el dato va metido en medio de una frase y no en un hueco de puntitos.
//
// Un "char" es una letra leída de la página: su carácter (c), la fuente y el tamaño con que está
// escrita, su color, si va en negrita y, si venía del documento, el glifo original con su posición.

import {
  PDFDict, PDFName, PDFRef, PDFStream,
  aPdf, anadirContenido, anadirRecurso, comoArray, comoNombre, comoNumero, escaparWinAnsi, heredado,
  letraWinAnsi, nombreBase, numero, numeros, obtener, resolver,
} from "./pdfbase.js";


/**
 * Lo que ocupa una letra, en puntos. Si su fuente está en el PDF se usa la anchura que trae el
 * propio documento; si no (una Ñ que el original no usa, por ejemplo), la de la Helvetica de
 * repuesto, que es con la que se va a dibujar. Medir y dibujar con la misma fuente es lo que
 * garantiza que las palabras caigan donde se ha calculado.
 */
export function anchoChar(ch, { mapas, respaldo }) {
  const glifo = mapas[nombreBase(ch.fuente)]?.[ch.c];
  if (glifo) return glifo.avance * ch.tamano;
  const fuente = ch.negrita ? respaldo.negrita : respaldo.normal;
  try {
    return fuente.widthOfTextAtSize(ch.c, ch.tamano);
  } catch {
    return 0.556 * ch.tamano; // letra rarísima que ni siquiera tiene la Helvetica: ancho medio
  }
}

/** Agrupa las letras en palabras (se corta en cada espacio) y mide lo que ocupa cada una. */
export function enPalabras(chars, medida) {
  const palabras = [];
  let actual = null;
  for (const ch of chars) {
    if (ch.c === " ") {
      actual = null; // el espacio cierra la palabra; su ancho se calcula luego al justificar
      continue;
    }
    if (!actual) {
      actual = { chars: [], ancho: 0 };
      palabras.push(actual);
    }
    actual.chars.push(ch);
    actual.ancho += anchoChar(ch, medida);
  }
  for (const palabra of palabras) palabra.texto = palabra.chars.map((ch) => ch.c).join("");
  return palabras;
}

/**
 * Reparte las palabras en líneas y calcula la posición exacta de cada una, igual que hace el
 * programa de la Seguridad Social: se van metiendo palabras hasta que no cabe otra, y entonces el
 * hueco que sobra hasta el margen derecho se reparte por igual entre todos los espacios de esa
 * línea. La última línea no se estira: va con espacios normales.
 */
export function repartirEnLineas(palabras, parrafo, medida) {
  const modelo = palabras[0]?.chars[0];
  // El ancho del espacio, medido con la misma fuente del documento (son 2,49 puntos a cuerpo 9).
  const espacio = anchoChar({ ...modelo, c: " ", negrita: false }, medida) || 0.278 * (modelo?.tamano ?? 9);

  // Repartir las palabras: cada línea acepta palabras mientras no se pase del ancho de la columna.
  const lineas = [];
  let actual = { palabras: [], ancho: 0 };
  for (const palabra of palabras) {
    const ancho = actual.palabras.length ? actual.ancho + espacio + palabra.ancho : palabra.ancho;
    if (actual.palabras.length && ancho > parrafo.ancho + 0.01) {
      lineas.push(actual);
      actual = { palabras: [palabra], ancho: palabra.ancho };
    } else {
      actual.palabras.push(palabra);
      actual.ancho = ancho;
    }
  }
  if (actual.palabras.length) lineas.push(actual);

  // Y ahora, la posición de cada palabra dentro de su línea.
  return lineas.map((linea, i) => {
    const suma = linea.palabras.reduce((total, p) => total + p.ancho, 0);
    const huecos = linea.palabras.length - 1;
    const ultima = i === lineas.length - 1;
    // Lo que sobra hasta el margen se reparte entre los huecos (en la última línea, nada).
    const sobra = ultima || huecos <= 0 ? 0 : parrafo.ancho - suma - espacio * huecos;
    const estirar = huecos > 0 ? sobra / huecos : 0;
    // Altura: la de la línea original si existe y, si el párrafo ha crecido, una más abajo.
    const y = i < parrafo.yes.length ? parrafo.yes[i] : parrafo.yes.at(-1) + parrafo.interlineado * (i - parrafo.yes.length + 1);
    let x = parrafo.izquierda;
    return linea.palabras.map((palabra, k) => {
      if (k > 0) x += espacio + estirar;
      const colocada = { ...palabra, x, y };
      x += palabra.ancho;
      return colocada;
    });
  });
}

// ------------------------------------------------------------------ escritura

/**
 * Busca en la página la fuente que se llama `base` (ArialMT, Calibri-Bold…) y devuelve una
 * referencia a ella junto con la manera de escribir con ella. Hay dos maneras, según cómo la haya
 * metido el programa que creó el PDF:
 *   "glifos"   fuentes "Type0" con codificación "Identity-H": cada letra se pide por su número de
 *              glifo dentro de la fuente. Es como mete las suyas el TA2 de la Seguridad Social.
 *   "winansi"  fuentes normales (TrueType o Type1) con codificación WinAnsi: la letra se escribe
 *              tal cual, con su código de siempre. Es como las mete Word, y es lo que trae el
 *              documento de MACADAMIA.
 * Si no es de ninguno de los dos tipos devuelve null y se tira de la Helvetica de repuesto.
 */
function fuenteDelPdf(doc, pagina, base) {
  const fuentes = obtener(doc, heredado(doc, pagina.node, "Resources"), "Font");
  if (!(fuentes instanceof PDFDict)) return null;
  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    const nombre = comoNombre(obtener(doc, fuente, "BaseFont"));
    if (!nombre || nombreBase(nombre) !== base) continue;
    const modo = modoDeEscritura(doc, fuente);
    if (!modo) continue;
    return { ref: valor instanceof PDFRef ? valor : doc.context.register(fuente), modo };
  }
  return null;
}

/** Cómo se escribe con esa fuente: "glifos", "winansi", o null si no se sabe escribir con ella. */
function modoDeEscritura(doc, fuente) {
  const subtipo = comoNombre(obtener(doc, fuente, "Subtype"));
  const codificacion = comoNombre(obtener(doc, fuente, "Encoding"));
  if (subtipo === "Type0") {
    if (codificacion !== "Identity-H") return null;
    // CIDToGIDMap "Identity" significa que el número que se escribe es directamente el del glifo;
    // si el PDF trae otra tabla de conversión, mejor no arriesgarse y usar la fuente de repuesto.
    const descendiente = resolver(doc, comoArray(doc, obtener(doc, fuente, "DescendantFonts"))?.[0]);
    const mapa = obtener(doc, descendiente, "CIDToGIDMap");
    if (mapa instanceof PDFStream) return null;
    if (mapa !== undefined && !(mapa instanceof PDFName && mapa.decodeText() === "Identity")) return null;
    return "glifos";
  }
  if (subtipo === "TrueType" || subtipo === "Type1") return codificacion === "WinAnsiEncoding" ? "winansi" : null;
  return null;
}

/**
 * Las letras y las anchuras de las fuentes normales (WinAnsi) de una página, sacadas de la tabla
 * /Widths que el propio PDF trae para cada una.
 *
 * POR QUÉ NO VALE CON MIRAR LAS LETRAS YA DIBUJADAS
 * La otra forma de saber cuánto mide cada letra es fijarse en las que ya están escritas en el
 * documento (es lo que hace `recorrerTexto`, y es lo que vale para el TA2). Se queda corta en un
 * documento de Word como el de MACADAMIA: el nombre del trabajador va en negrita, y de la negrita
 * el documento solo usa las letras del nombre del ejemplo. Con el trabajador siguiente faltaría
 * medio abecedario y saldría escrito con la Helvetica de repuesto, que ni mide ni se parece a la
 * Calibri de al lado. La tabla /Widths, en cambio, trae las anchuras de TODAS las letras, y la
 * fuente que va incrustada en el documento las lleva todas dibujadas.
 */
export function mapasWinAnsi(doc, pagina) {
  const mapas = {};
  const fuentes = obtener(doc, heredado(doc, pagina.node, "Resources"), "Font");
  if (!(fuentes instanceof PDFDict)) return mapas;
  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    if (modoDeEscritura(doc, fuente) !== "winansi") continue;
    const base = nombreBase(comoNombre(obtener(doc, fuente, "BaseFont")) ?? "");
    const primero = comoNumero(obtener(doc, fuente, "FirstChar"));
    const anchos = numeros(doc, obtener(doc, fuente, "Widths"));
    if (primero === undefined || !anchos?.length) continue;
    const mapa = (mapas[base] ??= {});
    anchos.forEach((ancho, i) => {
      const letra = letraWinAnsi(primero + i);
      // Las anchuras del PDF van en milésimas del tamaño de la letra.
      if (letra && ancho > 0 && !(letra in mapa)) mapa[letra] = { avance: ancho / 1000 };
    });
  }
  return mapas;
}

/**
 * Dibuja en la página las palabras ya colocadas. Un PDF no guarda "texto" sino instrucciones de
 * dibujo, así que se genera una lista de operadores:
 *   q … Q        abre y cierra el bloque, para no alterar nada de lo que ya había
 *   BT … ET      empieza y termina el texto
 *   /F 9 Tf      usa la fuente F a cuerpo 9
 *   1 0 0 1 x y Tm   coloca la pluma en el punto (x, y)
 *   <0044…> Tj   escribe esas letras (en hexadecimal, por número de glifo)
 *   (texto) Tj   escribe esas letras (texto normal, con la fuente de repuesto)
 * Cada palabra se coloca con su propio Tm, que es justamente como lo hace el documento original.
 */
export function escribir(doc, pagina, lineas, { mapas, respaldo }) {
  // Las fuentes se añaden a la página una sola vez y se reutiliza su nombre (/FTa1, /FTa2…).
  const recursos = new Map();
  const fuenteDe = (base, propia, negrita) => {
    const clave = propia ? base : `respaldo-${negrita ? "b" : "n"}`;
    if (!recursos.has(clave)) {
      const propio = propia ? fuenteDelPdf(doc, pagina, base) : null;
      const valor = propio?.ref ?? (negrita ? respaldo.negrita : respaldo.normal).ref;
      // La Helvetica de repuesto también se escribe con los códigos de siempre (WinAnsi).
      recursos.set(clave, { nombre: anadirRecurso(doc, pagina, "Font", "FTa", valor), modo: propio?.modo ?? "winansi" });
    }
    return recursos.get(clave);
  };

  // Se parte de un estado de texto limpio: sin espaciado extra entre letras ni palabras (Tc, Tw),
  // sin subir ni bajar la línea base (Ts), en modo de relleno normal (Tr) y sin estrechar (Tz).
  const operadores = ["q BT 0 Tc 0 Tw 0 Ts 0 Tr 100 Tz"];
  let colorActual = null;
  for (const linea of lineas) {
    for (const palabra of linea) {
      // Una palabra puede necesitar varios trozos: cambia de fuente (negrita a normal) o tiene
      // alguna letra que no está en el PDF y hay que sacar de la Helvetica de repuesto. Cada trozo
      // se dibuja por separado, y se va llevando la cuenta de la x para saber dónde empieza cada uno.
      let x = palabra.x;
      let trozo = null;
      const trozos = [];
      for (const ch of palabra.chars) {
        const base = nombreBase(ch.fuente);
        const propio = Boolean(mapas[base]?.[ch.c]); // ¿la trae el propio PDF?
        if (!trozo || trozo.base !== base || trozo.propio !== propio) {
          trozo = { base, propio, negrita: ch.negrita, tamano: ch.tamano, color: ch.color, x, chars: [] };
          trozos.push(trozo);
        }
        trozo.chars.push(ch);
        x += anchoChar(ch, { mapas, respaldo });
      }

      for (const t of trozos) {
        const fuente = fuenteDe(t.base, t.propio, t.negrita);
        // Las posiciones se llevan en coordenadas de pantalla (origen arriba a la izquierda) y
        // `aPdf` las pasa a las del PDF (origen abajo a la izquierda).
        const [px, py] = aPdf(doc, pagina, [t.x, palabra.y]);
        const color = (t.color?.length === 3 ? t.color : [0, 0, 0]).map(numero).join(" ");
        if (color !== colorActual) {
          operadores.push(`${color} rg`); // solo se repite la orden de color cuando cambia
          colorActual = color;
        }
        const texto = fuente.modo === "glifos"
          // Fuente "Identity-H": cada letra es su número de glifo en cuatro cifras hexadecimales.
          ? `<${t.chars.map((ch) => mapas[t.base][ch.c].gid.toString(16).padStart(4, "0")).join("")}>`
          // Fuente normal (y también la Helvetica de repuesto): la letra, con su código de siempre.
          : `(${escaparWinAnsi(t.chars.map((ch) => ch.c).join(""))})`;
        operadores.push(`/${fuente.nombre} ${numero(t.tamano)} Tf 1 0 0 1 ${numero(px)} ${numero(py)} Tm ${texto} Tj`);
      }
    }
  }
  operadores.push("ET Q");
  anadirContenido(doc, pagina, operadores.join("\n"));
}
