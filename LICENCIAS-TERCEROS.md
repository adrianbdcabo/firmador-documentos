# Librerías de terceros

La web usa estas librerías, que están en `vendor/` con el texto completo de sus licencias.
Todas son licencias permisivas: permiten usarlas en un programa propio y cerrado, siempre que
se conserve su aviso de copyright (que es lo que hace este archivo).

| Librería | Para qué se usa | Licencia | Archivo |
|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Abrir, modificar y guardar los PDF | MIT | `vendor/pdf-lib/LICENSE.md` |
| [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla) | Dibujar las páginas: vistas previas y captura de la firma | Apache-2.0 | `vendor/pdfjs/LICENSE` |
| Fuentes Foxit y Liberation (incluidas con pdf.js) | Sustituir las fuentes estándar al dibujar | Licencia Foxit y SIL Open Font License | `vendor/pdfjs/standard_fonts/LICENSE_FOXIT`, `LICENSE_LIBERATION` |
| Decodificadores JBIG2, OpenJPEG y QCMS (incluidos con pdf.js) | Imágenes y colores poco habituales dentro de los PDF | Apache-2.0, BSD-2 y MIT | `vendor/pdfjs/wasm/LICENSE_*` |
| [fast-png](https://github.com/image-js/fast-png) | Leer y escribir PNG | MIT | `vendor/imagenes/LICENSE-fast-png` |
| [jpeg-js](https://github.com/jpeg-js/jpeg-js) | Leer JPG fuera del navegador (en las pruebas) | BSD-3-Clause | `vendor/imagenes/LICENSE-jpeg-js` |
| [pako](https://github.com/nodeca/pako) | Comprimir (lo usa fast-png) | MIT y Zlib | `vendor/imagenes/LICENSE-pako` |
| [iobuffer](https://github.com/image-js/iobuffer) | Leer y escribir bytes (lo usa fast-png) | MIT | `vendor/imagenes/LICENSE-iobuffer` |

`vendor/imagenes/imagenes.min.js` es fast-png y jpeg-js (con pako e iobuffer) en un solo
archivo, generado con esbuild a partir de los paquetes originales.
