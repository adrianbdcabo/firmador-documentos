// © 2026 Adrián Barroso de Cabo.
// Completa las fuentes de un PDF hecho con Word, para que se pueda escribir con ellas cualquier
// nombre. Lo usan los scripts que preparan las plantillas de MACADAMIA y de CALIER.
//
// POR QUÉ HACE FALTA
// Word, al guardar el PDF, mete la Calibri entera pero con los dibujos de las letras que el
// documento no usa borrados. Si en el documento no sale ninguna "Z", la plantilla no sabe dibujar
// una "Z": cualquier nombre con letras nuevas saldría con medio abecedario en otra letra. Así que se
// cambia cada fuente por la de verdad de Windows, recortada a las letras que pueden hacer falta
// (unas 200, las de WinAnsi), y se rehace su tabla de anchuras.
//
// SOBRE LA FUENTE
// La Calibri de Windows permite incrustarse en documentos (su permiso de incrustación es el de
// "edición"), que es justo lo que ya venía haciendo el Word con el que se hicieron los originales.
import { readFileSync } from "node:fs";
import { recortarFuente } from "./subconjunto-ttf.mjs";
import {
  PDFDict, PDFName, PDFRawStream, comoNombre, heredado, letraWinAnsi, nombreBase, obtener, resolver,
} from "../js/pdfbase.js";

// Las letras que se dejan dentro de la fuente: todas las de WinAnsi, que es la codificación con la
// que el documento escribe. Así vale cualquier nombre, con tildes, eñes o lo que haga falta.
const LETRAS = [];
for (let codigo = 32; codigo < 256; codigo++) {
  const letra = letraWinAnsi(codigo);
  if (letra) LETRAS.push({ codigo, letra });
}

/**
 * Cambia en la primera página de `doc` las fuentes cuyo nombre esté en `rutas` (por ejemplo
 * { Calibri: "C:/Windows/Fonts/calibri.ttf" }) por su copia completa. Solo toca las fuentes
 * normales con codificación WinAnsi, que son las que mete Word para el texto corrido. Devuelve
 * cuántas ha cambiado.
 */
export function completarFuentes(doc, rutas) {
  const fuentes = obtener(doc, heredado(doc, doc.getPage(0).node, "Resources"), "Font");
  let cambiadas = 0;

  for (const [, valor] of fuentes.entries()) {
    const fuente = resolver(doc, valor);
    if (!(fuente instanceof PDFDict)) continue;
    const base = nombreBase(comoNombre(obtener(doc, fuente, "BaseFont")) ?? "");
    const ruta = rutas[base];
    if (!ruta) {
      console.log(`${base}: no hay copia completa de esta fuente, se deja como está`);
      continue;
    }
    // Word a veces mete la misma Calibri dos veces: la normal y otra "Type0" para símbolos sueltos
    // (las casillas □ de CALIER). Esa segunda escribe por número de dibujo y no hay que tocarla.
    if (comoNombre(obtener(doc, fuente, "Subtype")) !== "TrueType" || comoNombre(obtener(doc, fuente, "Encoding")) !== "WinAnsiEncoding") {
      console.log(`${base}: no es una fuente WinAnsi, se deja como está`);
      continue;
    }

    const { fuente: recortada, anchuras } = recortarFuente(new Uint8Array(readFileSync(ruta)), LETRAS.map((l) => l.letra));

    // El dibujo de la fuente vive en /FontFile2, dentro del descriptor. Se cambian sus bytes y los
    // dos tamaños que dependen de ellos: /Length (lo que ocupa en el PDF) y /Length1 (la fuente).
    const descriptor = resolver(doc, obtener(doc, fuente, "FontDescriptor"));
    const referencia = descriptor.get(PDFName.of("FontFile2"));
    const archivo = resolver(doc, referencia);
    if (!(archivo instanceof PDFRawStream)) throw new Error(`${base}: la fuente no viene incrustada como se esperaba`);
    if (compartido(doc, referencia, descriptor)) {
      // Otra fuente dibuja con este mismo archivo (en CALIER, la de las casillas □). Esa pide los
      // dibujos por su número, y al recortar se quedarían en blanco: la completa va aparte.
      const nuevo = doc.context.stream(recortada, { Length1: recortada.length });
      descriptor.set(PDFName.of("FontFile2"), doc.context.register(nuevo));
    } else {
      archivo.contents = recortada;
      archivo.dict.delete(PDFName.of("Filter")); // los bytes nuevos van sin comprimir
      archivo.dict.set(PDFName.of("Length"), doc.context.obj(recortada.length));
      archivo.dict.set(PDFName.of("Length1"), doc.context.obj(recortada.length));
    }

    // Y la tabla de anchuras, que ahora tiene que cubrir todas las letras: el PDF la usa para
    // repartir el texto, así que si no coincide con la fuente las palabras se descolocan.
    fuente.set(PDFName.of("FirstChar"), doc.context.obj(32));
    fuente.set(PDFName.of("LastChar"), doc.context.obj(255));
    const anchos = [];
    for (let codigo = 32; codigo <= 255; codigo++) {
      const letra = letraWinAnsi(codigo);
      anchos.push(doc.context.obj(letra ? anchuras.get(letra) ?? 0 : 0));
    }
    fuente.set(PDFName.of("Widths"), doc.context.obj(anchos));
    console.log(`${base}: fuente completa (${(recortada.length / 1024).toFixed(0)} kB) y ${anchos.length} anchuras`);
    cambiadas++;
  }

  return cambiadas;
}

/**
 * ¿Hay otro descriptor de fuente en el documento que use el mismo archivo de fuente? Word lo hace
 * cuando la misma letra sale de dos maneras: como texto normal y como símbolos sueltos.
 */
function compartido(doc, referencia, propio) {
  for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
    if (objeto === propio || !(objeto instanceof PDFDict)) continue;
    if (comoNombre(objeto.get(PDFName.of("Type"))) !== "FontDescriptor") continue;
    if (objeto.get(PDFName.of("FontFile2")) === referencia) return true;
  }
  return false;
}
