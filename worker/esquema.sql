-- © 2026 Adrián Barroso de Cabo.
-- Las tablas de la carpeta compartida de ITA (base de datos D1 "firmador-itas", en Europa).
-- Se crean con `npm run esquema` y no hace falta volver a tocarlas.

-- Un ITA: el informe de trabajadores en alta de una cuenta de cotización en un día.
-- El "id" es "cuenta|fecha", así que solo puede haber uno por cuenta y día; si llega otro del
-- mismo día se queda el que se haya sacado más tarde (se compara "emision").
CREATE TABLE IF NOT EXISTS itas (
  id          TEXT PRIMARY KEY,
  fecha       TEXT NOT NULL,   -- la fecha del informe, aaaa-mm-dd (así ordena sola)
  cuenta      TEXT,            -- "0111 37 107366063"
  referencia  TEXT,            -- la referencia de la codificación informática del pie
  emision     TEXT,            -- cuándo se sacó del Sistema RED: aaaa-mm-ddThh:mm:ss
  archivo     TEXT,            -- el nombre con el que se subió, solo para reconocerlo
  paginas     INTEGER,
  tamano      INTEGER,         -- bytes del PDF
  trabajador_count INTEGER,    -- cuánta gente trae, para enseñarlo sin contar filas
  subido      TEXT NOT NULL    -- cuándo se subió a la web, en hora universal
);

-- Cada persona que sale en un ITA y en qué página está. El índice por documento es lo que hace
-- que buscar un DNI/NIE sea instantáneo por muchos ITA que haya guardados.
CREATE TABLE IF NOT EXISTS trabajadores (
  ita_id     TEXT NOT NULL,
  documento  TEXT NOT NULL,    -- DNI/NIE con 10 caracteres, como lo escribe el ITA
  nombre     TEXT,
  naf        TEXT,
  alta       TEXT,             -- fecha de alta, aaaa-mm-dd
  pagina     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trabajadores_documento ON trabajadores (documento);
CREATE INDEX IF NOT EXISTS idx_trabajadores_ita ON trabajadores (ita_id);

-- El PDF, partido en trozos: D1 no admite filas de más de 2 MB, así que se guarda en texto
-- (base64) repartido en pedazos y al descargarlo se vuelven a pegar en orden.
CREATE TABLE IF NOT EXISTS trozos (
  ita_id  TEXT NOT NULL,
  n       INTEGER NOT NULL,
  datos   TEXT NOT NULL,
  PRIMARY KEY (ita_id, n)
);
