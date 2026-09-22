# Firmador de documentos laborales

Creado por **Adrián Barroso de Cabo**. © 2026 Adrián Barroso de Cabo.

Página web que coge el documento laboral (global), saca las 3 hojas que hay que enviar
(INFO, EPI y REN), pega en cada una la firma del trabajador debajo de su nombre y el sello
de la empresa, y las descarga en PDF.

**Los documentos laborales se procesan en el navegador**: no se envían a ningún servidor ni se
guardan en ningún sitio. La única excepción son los ITA, que en la web de Cloudflare se guardan
diez días en una carpeta compartida por toda la oficina (ver *Los ITA* más abajo).

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
6. **TA2 del trabajador** descarga el informe de situación de alta relleno con su nombre,
   fecha de nacimiento, NAF y DNI/NIE, y con la fecha de efectos del día. Las casillas de la
   codificación informática se entregan en blanco: sin ellas el documento no es válido.
7. Debajo del nombre se ven el **DNI/NIE y el NAF** del trabajador (el NAF con los dos dígitos
   de la provincia separados, "28 1548815306"), para tenerlos a mano al entrar en la Seguridad
   Social.

## Los ITA

Un ITA es el informe de trabajadores en alta de una cuenta de cotización. Al cargar un
documento laboral, la web mira si ese DNI/NIE aparece en los ITA guardados y ofrece descargar
el más reciente, avisando si tiene más de 7 días (las empresas usuarias no suelen aceptarlo).

Se guardan en uno de dos sitios, y la web elige solo:

- **La carpeta compartida** (en la web de Cloudflare): los ITA que sube cualquiera los ven
  todos, así que basta con que uno suba el del día. Viven en una base de datos D1 creada en
  Europa occidental y se borran a los 10 días, solos, de madrugada.
- **El almacén del navegador** (en cualquier otro sitio, como la copia de GitHub): los ITA no
  salen del ordenador y cada uno tiene los suyos. Es el respaldo si no hay servidor.

Si se sube otro ITA de la misma cuenta y el mismo día, se queda **el que se sacó más tarde**
del Sistema RED: a lo largo de la jornada se dan altas nuevas. La hora la trae el propio
informe en el pie ("CODIFICACIONES INFORMÁTICAS … FECHA: 18-09-2026 HORA: 09:55:17").

Quitar un ITA de la carpeta compartida solo pueden los correos de `CORREOS_ADMIN`
(en `wrangler.jsonc`); los demás solo suben y consultan.

### Añadir un documento especial

1. Copia su plantilla en `plantillas/`.
2. Añade su ficha en `js/especiales.js`: texto del botón, archivo, página que se rellena y
   dónde va cada dato (en puntos desde arriba a la izquierda, con la "y" en la línea base del texto, y el
   ancho del hueco para que el texto se encoja si no cabe).

Ahora mismo hay trece: REAL MADRID, ATLETI, CEPSA, CUN MADRID, IESE MADRID, MERCK TRES CANTOS,
MONTESA HONDA, PHARMAMAR, PLASTIPAK, SANDOZ, TALGO, TELEFONICA y THALES. Tres de ellos descargan
dos documentos: SANDOZ (RECIBI e INFO), CEPSA (ANEXO 12 y ANEXO 24) y TALGO (REGISTRO DE MEDIO
AMBIENTE y ACUSE RECIBO).

**El orden de los botones** no es el de la lista: lo decide `ordenados()` en `js/especiales.js`.
REAL MADRID y ATLETI van siempre los primeros, porque son de sitios concretos y se piden mucho, y
el resto va por orden alfabético.

Al rellenar, la web no copia literalmente cómo se hacían estos impresos a mano: escribe todo del
mismo tamaño y en negro (aunque el original tuviera la fecha en rojo o cada dato de una letra), y
centra las firmas dentro de su casilla para que no tapen las rayas de las tablas.

### El sello de la empresa

El sello está en `recursos/sello-temps.jpeg` y la web lo pega al generar cada documento, así que
para cambiarlo basta con sustituir ese archivo. La excepción son tres plantillas (CEPSA ANEXO 24,
CUN MADRID e IESE MADRID) que lo traen ya dibujado dentro; para esas hay que ejecutar además:

```sh
node scripts/sello-en-plantillas.mjs
```

## Desarrollo

Es una web estática sin paso de compilación: `index.html`, `css/`, `js/` y las librerías en
`vendor/` (pdf-lib, pdf.js y los lectores de imágenes). Para probarla en local hace falta servirla por HTTP (no abrir el archivo
directamente), por ejemplo:

```sh
npx http-server -p 8080
```

Así se prueba sin servidor: los ITA van al almacén del navegador. Para probar también la
carpeta compartida hace falta levantar el Worker con su base de datos:

```sh
node scripts/preparar-dist.mjs
npm run esquema:local          # crea las tablas en la base de datos de prueba
npx wrangler dev --port 8787   # la web en http://127.0.0.1:8787 con /api/ funcionando
```

En local no hay Cloudflare Access, así que no se sabe quién entra y no se puede borrar; para
hacer como si fueras tú, manda la cabecera `Cf-Access-Authenticated-User-Email`.

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
- `itas.js`: leer un ITA, guardarlo (en la carpeta compartida o en el navegador) y buscar en ellos.
- `ta2.js`: rellenar el TA2 con los datos del trabajador y la fecha del día.

Y fuera de `js/`:

- `worker/index.js`: el servidor de la carpeta compartida de ITA en Cloudflare (solo `/api/...`).
- `worker/esquema.sql`: las tablas de esa base de datos; se crean con `npm run esquema`.
- `wrangler.jsonc`: la configuración de Cloudflare (base de datos, correos que pueden borrar y
  la limpieza automática de cada madrugada).

Para actualizar las librerías: `npm install pdf-lib@latest pdfjs-dist@latest fast-png@latest jpeg-js@latest`
y copiar a `vendor/` `pdf-lib.esm.min.js`, los archivos de `pdfjs-dist/legacy/build/` (más
`standard_fonts/` y `wasm/`) y volver a generar `vendor/imagenes/imagenes.min.js` con esbuild.

## Autoría y licencia

Copyright © 2026 Adrián Barroso de Cabo. Autor y titular de los derechos de este programa.

Programa propio: **todos los derechos reservados** (ver [LICENSE](LICENSE)). No se puede
copiar, distribuir ni usar sin permiso por escrito del autor.

Las librerías de terceros que usa tienen licencias permisivas (MIT, Apache-2.0, BSD) y están
detalladas en [LICENCIAS-TERCEROS.md](LICENCIAS-TERCEROS.md).
