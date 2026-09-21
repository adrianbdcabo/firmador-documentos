// © 2026 Adrián Barroso de Cabo.
// El servidor de la web en Cloudflare: la carpeta compartida de ITA.
//
// PARA QUÉ SIRVE
// Hasta ahora cada compañero guardaba los ITA en su propio navegador, así que el que subía el ITA
// del día era el único que lo tenía. Aquí se guardan una sola vez y los ven todos: el que lo sube
// por la mañana se lo ahorra a los demás.
//
// QUÉ ES ESTE ARCHIVO
// La web sigue siendo páginas y archivos estáticos (index.html, js/…, plantillas/…). Cloudflare los
// sirve él solo; solo cuando la dirección NO es uno de esos archivos llega aquí. Por eso este
// código únicamente atiende las direcciones que empiezan por /api/ y a todo lo demás contesta 404.
//
// DÓNDE SE GUARDA
// En una base de datos D1 (el SQLite de Cloudflare) creada en Europa occidental, con tres tablas:
// los datos de cada ITA, la lista de personas que trae (para poder buscar un DNI al instante) y el
// PDF partido en trozos. El esquema está en worker/esquema.sql.
//
// QUIÉN ENTRA
// Delante de todo esto está Cloudflare Access: nadie llega hasta aquí sin haber entrado con su
// correo. Access añade a cada petición la cabecera "Cf-Access-Authenticated-User-Email" con el
// correo de quien entra, y es de ahí de donde se saca quién es. Borrar solo lo pueden los correos
// de CORREOS_ADMIN (una variable de wrangler.jsonc); los demás solo suben y consultan.
//
// SE BORRAN SOLOS
// Un ITA de más de DIAS_GUARDADOS días ya no vale para mandárselo a una empresa usuaria, así que
// se borra. La limpieza la lanza sola Cloudflare cada madrugada (el "cron" de wrangler.jsonc), y
// además se repasa cada vez que alguien pide la lista, por si el cron hubiera fallado.

const DIAS_GUARDADOS = 10; // el mismo número que usa la web en js/itas.js
const TROZO = 400000; // letras de base64 por fila: D1 no admite filas de más de 2 MB
const MAXIMO_PDF = 20 * 1024 * 1024; // un ITA no llega ni de lejos; es solo un tope de seguridad

export default {
  async fetch(peticion, entorno) {
    const url = new URL(peticion.url);
    if (!url.pathname.startsWith("/api/")) return new Response("No encontrado", { status: 404 });
    try {
      return await atender(peticion, url, entorno);
    } catch (error) {
      // Nunca se devuelve el error tal cual: podría contar cosas de la base de datos.
      console.error(error);
      return json({ error: "Ha fallado el servidor de ITA." }, 500);
    }
  },

  /** La limpieza de la madrugada que lanza Cloudflare (ver "triggers" en wrangler.jsonc). */
  async scheduled(evento, entorno) {
    const quitados = await limpiarAntiguos(entorno.DB);
    console.log(`limpieza automática: ${quitados} ITA de más de ${DIAS_GUARDADOS} días borrados`);
  },
};

/** Reparte cada dirección a lo que le toca hacer. */
async function atender(peticion, url, entorno) {
  const base = entorno.DB;
  if (!base) return json({ error: "La base de datos no está configurada." }, 503);
  const ruta = url.pathname.slice("/api/".length);

  if (ruta === "itas" && peticion.method === "GET") return listar(base, quienEs(peticion, entorno));
  if (ruta === "itas" && peticion.method === "POST") return guardar(peticion, base);
  if (ruta === "itas/buscar" && peticion.method === "GET") return buscar(base, url.searchParams.get("documento") ?? "");

  // "itas/<id>/pdf" y "itas/<id>": el id lleva espacios y una barra vertical, así que va codificado.
  const pdf = /^itas\/(.+)\/pdf$/.exec(ruta);
  if (pdf && peticion.method === "GET") return descargar(base, decodeURIComponent(pdf[1]));

  const uno = /^itas\/(.+)$/.exec(ruta);
  if (uno && peticion.method === "DELETE") return borrar(base, decodeURIComponent(uno[1]), quienEs(peticion, entorno));

  return json({ error: "Esa dirección no existe." }, 404);
}

// ------------------------------------------------------------------ quién entra

/**
 * El correo de quien hace la petición y si puede borrar. El correo lo pone Cloudflare Access al
 * dejarle pasar; Cloudflare borra de las peticiones de fuera cualquier cabecera "Cf-", así que no
 * se puede falsear desde el navegador. Aun así, el que de verdad cierra la puerta es Access: esto
 * solo sirve para distinguir quién es de entre los que ya han entrado.
 */
function quienEs(peticion, entorno) {
  const correo = (peticion.headers.get("Cf-Access-Authenticated-User-Email") ?? "").toLowerCase().trim();
  const admins = (entorno.CORREOS_ADMIN ?? "").toLowerCase().split(",").map((c) => c.trim()).filter(Boolean);
  return { correo, puedeBorrar: Boolean(correo) && admins.includes(correo) };
}

// ------------------------------------------------------------------ las operaciones

/** La lista de ITA guardados, del más reciente al más antiguo, sin los PDF ni los trabajadores. */
async function listar(base, quien) {
  await limpiarAntiguos(base); // por si el cron de la madrugada no llegó a ejecutarse
  const { results } = await base
    .prepare("SELECT id, fecha, cuenta, referencia, emision, archivo, paginas, tamano, trabajador_count, subido FROM itas ORDER BY fecha DESC")
    .all();
  return json({
    almacen: "compartido",
    puedeBorrar: quien.puedeBorrar,
    correo: quien.correo,
    itas: results.map(comoFicha),
  });
}

/**
 * Guarda un ITA que manda la web ya leído (la web sabe leer el PDF; aquí solo se almacena).
 * Si ya hay uno de la misma cuenta y día, se queda el que se sacó más tarde del Sistema RED:
 * durante la jornada se dan altas nuevas, así que el de las 13:40 vale más que el de las 09:55.
 */
async function guardar(peticion, base) {
  const cuerpo = await peticion.json().catch(() => null);
  const ficha = cuerpo?.ficha;
  const base64 = cuerpo?.pdf;
  if (!ficha?.id || !ficha?.fecha || typeof base64 !== "string") return json({ error: "Faltan datos del ITA." }, 400);
  if (base64.length > (MAXIMO_PDF * 4) / 3) return json({ error: "El PDF es demasiado grande." }, 413);
  const trabajadores = Array.isArray(ficha.trabajadores) ? ficha.trabajadores : [];
  if (!trabajadores.length) return json({ error: "El ITA no trae ningún trabajador." }, 400);

  const anterior = await base.prepare("SELECT emision, subido FROM itas WHERE id = ?").bind(ficha.id).first();
  if (anterior) {
    // Si al ITA le falta la hora de la codificación se compara con la hora de subida, que es lo
    // más parecido que hay a "cuándo se sacó".
    const nueva = ficha.emision ?? new Date().toISOString();
    const vieja = anterior.emision ?? anterior.subido;
    if (nueva <= vieja) {
      return json({ guardado: false, motivo: "hay-uno-mas-nuevo", emision: anterior.emision, subido: anterior.subido });
    }
  }

  const subido = new Date().toISOString();
  const ordenes = [
    base.prepare("DELETE FROM trabajadores WHERE ita_id = ?").bind(ficha.id),
    base.prepare("DELETE FROM trozos WHERE ita_id = ?").bind(ficha.id),
    base.prepare(`INSERT OR REPLACE INTO itas
        (id, fecha, cuenta, referencia, emision, archivo, paginas, tamano, trabajador_count, subido)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(ficha.id, ficha.fecha, ficha.cuenta ?? null, ficha.referencia ?? null, ficha.emision ?? null,
        ficha.archivo ?? null, ficha.paginas ?? null, ficha.tamano ?? null, trabajadores.length, subido),
  ];
  for (const t of trabajadores) {
    ordenes.push(base.prepare("INSERT INTO trabajadores (ita_id, documento, nombre, naf, alta, pagina) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(ficha.id, t.documento, t.nombre ?? null, t.naf ?? null, t.alta ?? null, t.pagina ?? null));
  }
  for (let n = 0, i = 0; i < base64.length; n++, i += TROZO) {
    ordenes.push(base.prepare("INSERT INTO trozos (ita_id, n, datos) VALUES (?, ?, ?)").bind(ficha.id, n, base64.slice(i, i + TROZO)));
  }
  await base.batch(ordenes);
  return json({ guardado: true, sustituido: Boolean(anterior), trabajadores: trabajadores.length, subido });
}

/**
 * En qué ITA aparece un DNI/NIE, del más reciente al más antiguo: el primero de la lista es el que
 * hay que ofrecer para descargar. Una sola consulta, por muchos ITA que haya guardados.
 */
async function buscar(base, documento) {
  const buscado = normalizarDocumento(documento);
  if (!buscado || buscado === "0000000000") return json({ encontrados: [] });
  const { results } = await base.prepare(`
      SELECT i.id, i.fecha, i.cuenta, i.referencia, i.emision, i.archivo, i.paginas, i.tamano,
             i.trabajador_count, i.subido, t.nombre, t.naf, t.alta, t.pagina
        FROM trabajadores t JOIN itas i ON i.id = t.ita_id
       WHERE t.documento = ?
       ORDER BY i.fecha DESC`).bind(buscado).all();
  return json({
    encontrados: results.map((f) => ({
      ita: comoFicha(f),
      trabajador: { documento: buscado, nombre: f.nombre, naf: f.naf, alta: f.alta, pagina: f.pagina },
    })),
  });
}

/** El PDF de un ITA, pegando de nuevo sus trozos en orden. */
async function descargar(base, id) {
  const { results } = await base.prepare("SELECT datos FROM trozos WHERE ita_id = ? ORDER BY n").bind(id).all();
  if (!results.length) return json({ error: "Ese ITA ya no está guardado." }, 404);
  const bytes = deBase64(results.map((t) => t.datos).join(""));
  return new Response(bytes, {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
  });
}

/** Quita un ITA. Solo pueden los correos de CORREOS_ADMIN. */
async function borrar(base, id, quien) {
  if (!quien.puedeBorrar) return json({ error: "No tienes permiso para quitar ITA." }, 403);
  await quitar(base, [id]);
  return json({ borrado: true });
}

// ------------------------------------------------------------------ apoyos

/** Borra los ITA cuya fecha de informe pasa de DIAS_GUARDADOS días. Devuelve cuántos ha quitado. */
async function limpiarAntiguos(base) {
  const limite = new Date(Date.now() - DIAS_GUARDADOS * 86400000).toISOString().slice(0, 10);
  const { results } = await base.prepare("SELECT id FROM itas WHERE fecha < ?").bind(limite).all();
  const ids = results.map((f) => f.id);
  if (ids.length) await quitar(base, ids);
  return ids.length;
}

/** Borra de las tres tablas los ITA que se le digan. */
async function quitar(base, ids) {
  const ordenes = [];
  for (const id of ids) {
    ordenes.push(base.prepare("DELETE FROM trabajadores WHERE ita_id = ?").bind(id));
    ordenes.push(base.prepare("DELETE FROM trozos WHERE ita_id = ?").bind(id));
    ordenes.push(base.prepare("DELETE FROM itas WHERE id = ?").bind(id));
  }
  await base.batch(ordenes);
}

/** Una fila de la tabla "itas" con los nombres que usa la web. */
function comoFicha(fila) {
  return {
    id: fila.id,
    fecha: fila.fecha,
    cuenta: fila.cuenta,
    referencia: fila.referencia,
    emision: fila.emision,
    archivo: fila.archivo,
    paginas: fila.paginas,
    tamano: fila.tamano,
    cuantos: fila.trabajador_count, // cuánta gente trae; la lista entera no hace falta para listar
    subido: fila.subido,
  };
}

/** El DNI/NIE con 10 caracteres y en mayúsculas, igual que lo hace la web (js/itas.js). */
function normalizarDocumento(documento) {
  return (documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().padStart(10, "0");
}

/** De texto base64 a los bytes del PDF, poco a poco para no cargar la memoria de golpe. */
function deBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Una respuesta en JSON, que es como habla la web con este servidor. */
function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
