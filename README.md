# Firmador de documentos laborales

Página web que coge el documento laboral (global), saca las 3 hojas que hay que enviar
(INFO, EPI y REN), pega en cada una la firma del trabajador debajo de su nombre y el sello
de la empresa, y las descarga en PDF.

**Todo se procesa en el navegador.** Los documentos no se envían a ningún servidor ni se
guardan en ningún sitio. Lo único que se recuerda es el sello de la empresa, si se usa, y
solo en el navegador donde se cargó (no forma parte de esta web).

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
2. Opcional: **Poner fecha de hoy** cambia la fecha de "En COSLADA, a …" por la de hoy,
   con la misma letra y tamaño que el original.
3. Opcional: **Añadir sello** pone el sello de la empresa en INFO y REN. Cada documento
   empieza sin sello. La primera vez en cada navegador pide la imagen del sello y la
   recuerda para las siguientes (se puede cambiar con **Cambiar sello**).
4. Elige **3 documentos separados** o **Pack único** y pulsa **Descargar**. Para bajar solo
   una hoja, pincha sobre ella en la vista previa.
5. En **DOCUS ESPECIALES PLATAFORMAS**, a la derecha, cada botón descarga el documento
   que pide esa plataforma ya relleno con el nombre, el DNI, la fecha de hoy y la firma
   del trabajador.

### Añadir un documento especial

1. Copia su plantilla en `plantillas/`.
2. Añade su ficha en `js/especiales.js`: texto del botón, archivo, página que se rellena y
   dónde va cada dato (coordenadas de MuPDF, con la "y" en la línea base del texto, y el
   ancho del hueco para que el texto se encoja si no cabe).

## Desarrollo

Es una web estática sin paso de compilación: `index.html`, `css/`, `js/` y MuPDF.js en
`vendor/mupdf/`. Para probarla en local hace falta servirla por HTTP (no abrir el archivo
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

Para actualizar MuPDF.js: `npm install mupdf@latest` y copiar `mupdf.js`, `mupdf-wasm.js`
y `mupdf-wasm.wasm` de `node_modules/mupdf/dist/` a `vendor/mupdf/`.

## Licencia

Usa [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js), con licencia AGPL-3.0, por lo
que este proyecto se distribuye también bajo la [AGPL-3.0](LICENSE).
