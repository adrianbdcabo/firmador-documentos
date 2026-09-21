# Firmador de documentos laborales

Creado por **Adrián Barroso de Cabo**. © 2026 Adrián Barroso de Cabo.

Página web que coge el documento laboral (global), saca las 3 hojas que hay que enviar
(INFO, EPI y REN), pega en cada una la firma del trabajador debajo de su nombre y el sello
de la empresa, y las descarga en PDF.

**Todo se procesa en el navegador.** Los documentos no se envían a ningún servidor ni se
guardan en ningún sitio.

## Cómo se usa

1. Pulsa **Cargar documentos laborales** o arrastra el PDF a la página. Las hojas se buscan
   por su título, da igual cuántas páginas tenga el documento.
   - Si el documento está firmado digitalmente, se usa su propia firma.
   - Si no lo está (o quieres usar otra), pulsa **Cargar firma** y elige otro documento
     firmado o una captura de la firma. También puedes hacer la captura con
     `Win + Mayús + S` y pegarla con `Ctrl + V`.
   - La firma también se puede sacar de una hoja ya firmada (INFO, EPI o REN): se
     reconoce tanto en **Cargar firma** como si se carga en **Cargar documentos
     laborales**, y de ella se leen el nombre y el DNI que figuran en la hoja.
   - Si la firma sale de un PDF de otra persona (su NIF no coincide con el DNI del
     documento), la página avisa y pregunta.
   - La firma cargada sirve para ese documento; al cargar el siguiente se olvida.
2. **Poner fecha de hoy** cambia la fecha de "En COSLADA, a …" por la de hoy, con la misma
   letra y tamaño que el original.
3. **Añadir sello** pone el sello de la empresa en INFO y REN. Los dos interruptores vienen
   activados en cada documento que se carga; se pueden desactivar. El sello viene con la web (`recursos/sello-temps.jpeg`): para
   cambiarlo, se sustituye ese archivo.
4. Elige **3 documentos separados** o **Pack único** y pulsa **Descargar**. Para bajar solo
   una hoja, pincha sobre ella en la vista previa.
5. En **DOCUS ESPECIALES PLATAFORMAS**, a la derecha, cada botón descarga el documento
   que pide esa plataforma ya relleno con el nombre, el DNI, la fecha de hoy y la firma
   del trabajador.

### Añadir un documento especial

1. Copia su plantilla en `plantillas/`.
2. Añade su ficha en `js/especiales.js`: texto del botón, archivo, página que se rellena y
   dónde va cada dato (en puntos desde arriba a la izquierda, con la "y" en la línea base del texto, y el
   ancho del hueco para que el texto se encoja si no cabe).

Ahora mismo hay ocho: IESE MADRID, CUN MADRID, REAL MADRID, ATLETI, THALES, SANDOZ, CEPSA y PHARMAMAR
(SANDOZ descarga dos, RECIBI SANDOZ e INFO SANDOZ, y CEPSA otros dos, ANEXO 12 CEPSA y ANEXO 24 CEPSA) (el orden de los
botones es el de la lista en `js/especiales.js`).

## Desarrollo

Es una web estática sin paso de compilación: `index.html`, `css/`, `js/` y las librerías en
`vendor/` (pdf-lib, pdf.js y los lectores de imágenes). Para probarla en local hace falta servirla por HTTP (no abrir el archivo
directamente), por ejemplo:

```sh
npx http-server -p 8080
```

Pruebas automáticas (necesitan los documentos de ejemplo, que no están en el repositorio
porque contienen datos personales; por defecto se buscan en `~/DOCUMENTOS DE EJEMPLO`):

```sh
npm install
npm test
```

Qué hace cada archivo de `js/`:

- `app.js`: la interfaz (cargar, vistas previas, descargar).
- `pdf.js`: separa las hojas, captura la firma digital y pega firma y sello.
- `fecha.js`: cambia la fecha conservando la letra del documento.
- `lector.js`: lee el contenido de una página (qué letra hay en cada sitio) y permite modificarlo.
- `fuentes.js`: las fuentes del PDF (qué letra es cada código, cuánto mide).
- `pdfbase.js`: utilidades sobre pdf-lib (abrir, guardar, coordenadas, recursos).
- `render.js`: dibujar páginas con pdf.js.
- `imagenes.js`: leer y escribir PNG y JPG, recortar y componer.
- `especiales.js`: los documentos de plataformas.

Para actualizar las librerías: `npm install pdf-lib@latest pdfjs-dist@latest fast-png@latest jpeg-js@latest`
y copiar a `vendor/` `pdf-lib.esm.min.js`, los archivos de `pdfjs-dist/legacy/build/` (más
`standard_fonts/` y `wasm/`) y volver a generar `vendor/imagenes/imagenes.min.js` con esbuild.

## Autoría y licencia

Copyright © 2026 Adrián Barroso de Cabo. Autor y titular de los derechos de este programa.

Programa propio: **todos los derechos reservados** (ver [LICENSE](LICENSE)). No se puede
copiar, distribuir ni usar sin permiso por escrito del autor.

Las librerías de terceros que usa tienen licencias permisivas (MIT, Apache-2.0, BSD) y están
detalladas en [LICENCIAS-TERCEROS.md](LICENCIAS-TERCEROS.md).
