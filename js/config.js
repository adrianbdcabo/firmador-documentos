// © 2026 Adrián Barroso de Cabo. Licencia AGPL-3.0 (ver LICENSE).
// Qué hojas se extraen y dónde se pega la firma y el sello en cada una.
//
// Coordenadas en puntos PDF con origen arriba a la izquierda (como MuPDF).
// dx/dy se miden desde la esquina superior izquierda del texto "Fdo." y están calibrados
// con los documentos de ejemplo firmados a mano (INFO/EPI/REN HECHA). x/y son la posición
// fija que se usa si la hoja no tiene "Fdo.".

export const TEXTO_ANCLA = "Fdo.";
export const PPP_CAPTURA = 600; // resolución de la "captura" de la firma digital
export const MARGEN_CAPTURA_PT = 1.5; // blanco que se deja alrededor del texto de la firma
export const HOJA_NOMBRE = "INFO"; // hoja de la que se lee el nombre del trabajador

export const CAJA_FIRMA = { ancho: 87, alto: 38 };
export const CAJA_SELLO = { ancho: 185, alto: 137.13 };

export const HOJAS = [
  {
    clave: "INFO",
    titulo: "DOCUMENTO ACREDITATIVO INFORMACIÓN Y FORMACION EN MATERIA DE PREVENCIÓN DE RIESGOS LABORALES",
    busqueda: "DOCUMENTO ACREDITATIVO INFORMACION Y FORMACION EN MATERIA DE PREVENCION",
    ladoAncla: "izquierda",
    firma: { dx: 1.04, dy: 43.1, x: 41.04, y: 661.58 },
    sello: { dx: 285.54, dy: -8.39, x: 325.54, y: 610.08 },
  },
  {
    clave: "EPI",
    titulo: "REGISTRO DE ENTREGA DE EQUIPOS DE PROTECCIÓN INDIVIDUAL AL TRABAJADOR/A",
    busqueda: "REGISTRO DE ENTREGA DE EQUIPOS DE PROTECCION INDIVIDUAL",
    ladoAncla: "derecha",
    firma: { dx: 26.43, dy: 39.84, x: 368.43, y: 608.61 },
    sello: null, // el sello de la empresa ya viene impreso en esta hoja
  },
  {
    clave: "REN",
    titulo: "RENUNCIA VOLUNTARIA AL RECONOCIMIENTO MÉDICO",
    busqueda: "RENUNCIA VOLUNTARIA AL RECONOCIMIENTO MEDICO",
    ladoAncla: "izquierda",
    firma: { dx: 2.1, dy: 42.98, x: 42.1, y: 742.11 },
    sello: { dx: 309.9, dy: -39.24, x: 349.9, y: 659.88 },
  },
];
