/**
 * Iconos propios de DataDB (fase 8, T5; decisión D1 de R34). El producto se llamaba GestorDB hasta la fase 5.
 *
 * Copyright 2026 DataDB — proyecto privado, todos los derechos reservados.
 * Dibujados para este proyecto con la gramática del set `expui` de JetBrains (Nueva UI):
 *   - viewBox 16×16, trazo de 1 px, esquinas redondeadas, rellenos planos;
 *   - colores SOLO vía los tokens `--gdb-ic*` (D3: siguen la paleta editable igual que los importados);
 *   - sin ids internos (no hay nada que prefijar; el test de ids únicos de generated.test.ts los cubre al fundirse).
 *
 * Por qué existen: el set abierto de intellij-community NO trae iconos de objetos de base de datos
 * (base de datos, vista, procedimiento, trigger, PK, FK): son del plugin cerrado de DataGrip
 * (.planning/phases/phase-8/PLAN.md, «Hueco 1»). Los de acción (conectar, desconectar, consola, IA,
 * Explain) tampoco tienen equivalente importable con cabecera Apache 2.0 (los de IA de JetBrains no la llevan).
 *
 * primaryKey y foreignKey son BADGES: su dibujo vive en el cuadrante inferior-derecho del viewBox para
 * superponerlos al icono de columna, como hace DataGrip (research/datagrip-ux.md §2.1: combinaciones de
 * columna = badges superpuestos, no un icono por combinación).
 *
 * Borradores para la hoja de contacto (T5): el usuario los revisa contra el set real ANTES de aplicarlos.
 */
export const CUSTOM_ICONS = {
  // Base de datos / data source: cilindro clásico (el símbolo universal de BD), mismos roles que nodes/dataTables
  // (relleno icfill + trazo icstroke). La elipse superior se pinta al final para que su arco inferior se vea.
  database:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M2.5 3.75V12.25C2.5 13.3546 4.96243 14.25 8 14.25C11.0376 14.25 13.5 13.3546 13.5 12.25V3.75" fill="var(--gdb-icfill)" stroke="var(--gdb-icstroke)"/>' +
    '<path d="M2.5 8C2.5 9.10457 4.96243 10 8 10C11.0376 10 13.5 9.10457 13.5 8" stroke="var(--gdb-icstroke)"/>' +
    '<ellipse cx="8" cy="3.75" rx="5.5" ry="2" fill="var(--gdb-icfill)" stroke="var(--gdb-icstroke)"/>' +
    "</svg>",

  // Vista: la MISMA mesa que nodes/dataSchema (geometría copiada del icono importado, incluido el vaciado
  // inferior-derecho) con un ojo azul donde dataSchema lleva la lupa: familia exacta con «esquema».
  view:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M1 4C1 2.89543 1.89543 2 3 2H13C14.1046 2 15 2.89543 15 4V11C15 9.98555 14.6224 9.05931 14 8.35418V6H11V7C10.6547 7 10.3196 7.04375 10 7.12602V6H6V13H7.53513C7.75287 13.3764 8.03018 13.714 8.35418 14H3C1.89543 14 1 13.1046 1 12V4ZM6 3H10V5H6V3ZM5 3H3C2.44772 3 2 3.44772 2 4V5H5V3ZM2 6V12C2 12.5523 2.44772 13 3 13H5V6H2ZM14 5V4C14 3.44772 13.5523 3 13 3H11V5H14Z" fill="var(--gdb-icstroke)"/>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M11 8.2C9.2 8.2 7.68 9.42 7.14 11C7.68 12.58 9.2 13.8 11 13.8C12.8 13.8 14.32 12.58 14.86 11C14.32 9.42 12.8 8.2 11 8.2ZM11 12.7C10.0611 12.7 9.3 11.9389 9.3 11C9.3 10.0611 10.0611 9.3 11 9.3C11.9389 9.3 12.7 10.0611 12.7 11C12.7 11.9389 11.9389 12.7 11 12.7Z" fill="var(--gdb-icblue)"/>' +
    '<circle cx="11" cy="11" r="0.9" fill="var(--gdb-icblue)"/>' +
    "</svg>",

  // Procedimiento almacenado: círculo con «P», estructura idéntica a nodes/function (círculo + glifo),
  // pero en azul sólido con el glifo en icbadgefg (patrón de status/success): function es rojo, así que
  // el azul lo separa sin inventar un rol de color nuevo.
  procedure:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="8" cy="8" r="6.5" fill="var(--gdb-icblue)"/>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M6.1 12V4.2H9C10.4 4.2 11.4 5.15 11.4 6.5C11.4 7.85 10.4 8.8 9 8.8H7.7V12H6.1ZM7.7 5.55V7.45H8.85C9.45 7.45 9.8 7.1 9.8 6.5C9.8 5.9 9.45 5.55 8.85 5.55H7.7Z" fill="var(--gdb-icbadgefg)"/>' +
    "</svg>",

  // Trigger: rayo en amarillo de aviso (icyellow), relleno plano como bookmark/star.
  trigger:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M9.8 1.2L3.9 8.6C3.7 8.86 3.88 9.25 4.2 9.25H7.1L6.2 14.8L12.1 7.4C12.3 7.14 12.12 6.75 11.8 6.75H8.9L9.8 1.2Z" fill="var(--gdb-icyellow)"/>' +
    "</svg>",

  // Badge de clave primaria: llave amarilla (icyellow, como la estrella de favoritos: lo «importante»)
  // en el cuadrante inferior-derecho, para superponer al icono de columna. El círculo de fondo usa
  // icfill, el neutro más cercano al panel en los tres temas: separa el badge del icono que hay debajo
  // (sin él, a 16 px la llave se funde con la columna — medido en la hoja de contacto).
  primaryKey:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="11.3" cy="11.3" r="4.4" fill="var(--gdb-icfill)"/>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M10.4 8.4C9.02 8.4 7.9 9.52 7.9 10.9C7.9 12.28 9.02 13.4 10.4 13.4C11.78 13.4 12.9 12.28 12.9 10.9C12.9 9.52 11.78 8.4 10.4 8.4ZM10.4 9.9C10.95 9.9 11.4 10.35 11.4 10.9C11.4 11.45 10.95 11.9 10.4 11.9C9.85 11.9 9.4 11.45 9.4 10.9C9.4 10.35 9.85 9.9 10.4 9.9Z" fill="var(--gdb-icyellow)"/>' +
    '<path d="M12.1 12.3L14.3 14.5" stroke="var(--gdb-icyellow)" stroke-width="1.8" stroke-linecap="round"/>' +
    "</svg>",

  // Badge de clave foránea: eslabón azul (icblue, el color de «navegable/enlace» que ya usa dataSchema
  // para su lupa) en el cuadrante inferior-derecho, con el mismo knockout de icfill que primaryKey.
  // Trazo grueso: a 16 px un eslabón fino desaparece sobre la columna (medido en la hoja de contacto).
  foreignKey:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="11.3" cy="11.3" r="4.4" fill="var(--gdb-icfill)"/>' +
    '<g transform="translate(11.3,11.3) scale(0.36)" stroke="var(--gdb-icblue)" stroke-width="3.6" stroke-linecap="round" fill="none">' +
    '<path d="M-4.5 0h-2.5a4.5 4.5 0 0 1 0-9h2.5"/><path d="M4.5 -9h2.5a4.5 4.5 0 0 1 0 9h-2.5"/><path d="M-3.5 -4.5h7"/>' +
    "</g></svg>",

  // Explain plan: árbol de plan (nodo raíz + dos hojas) en azul sobre conectores neutros; sustituye al
  // velocímetro de lucide, que no decía «plan». Mismos roles que diagram (icblue para lo semántico).
  explainPlan:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M8 4.9V8.1M4.6 11V8.1H11.4V11" stroke="var(--gdb-icstroke)" stroke-linecap="round"/>' +
    '<circle cx="8" cy="3.2" r="1.8" fill="var(--gdb-icblue)"/>' +
    '<circle cx="4.6" cy="12.8" r="1.8" fill="var(--gdb-icblue)"/>' +
    '<circle cx="11.4" cy="12.8" r="1.8" fill="var(--gdb-icblue)"/>' +
    "</svg>",

  // Conectar: enchufe (clavijas + cuerpo + cable), relleno icfill y trazo icstroke como el chrome neutro.
  connect:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5.75 1.5V4M10.25 1.5V4" stroke="var(--gdb-icstroke)" stroke-linecap="round"/>' +
    '<rect x="3.5" y="4" width="9" height="4.5" rx="1.5" fill="var(--gdb-icfill)" stroke="var(--gdb-icstroke)"/>' +
    '<path d="M8 8.5V11.5C8 12.8807 9.11929 14 10.5 14H13" stroke="var(--gdb-icstroke)" stroke-linecap="round"/>' +
    "</svg>",

  // Desconectar: el mismo enchufe con un corte rojo (icred = «parar/separar», como run/stop).
  disconnect:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5.75 1.5V4M10.25 1.5V4" stroke="var(--gdb-icstroke)" stroke-linecap="round"/>' +
    '<rect x="3.5" y="4" width="9" height="4.5" rx="1.5" fill="var(--gdb-icfill)" stroke="var(--gdb-icstroke)"/>' +
    '<path d="M8 8.5V11.5C8 12.8807 9.11929 14 10.5 14H13" stroke="var(--gdb-icstroke)" stroke-linecap="round"/>' +
    '<path d="M2.5 13.5L13.5 2.5" stroke="var(--gdb-icred)" stroke-width="1.4" stroke-linecap="round"/>' +
    "</svg>",

  // Consola SQL: terminal con prompt «>_» en azul (icblue, acción primaria: la consola es el corazón de la app).
  console:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="var(--gdb-icfill)" stroke="var(--gdb-icstroke)"/>' +
    '<path d="M4.6 6.2L6.6 8L4.6 9.8" stroke="var(--gdb-icblue)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8.2 10.2H11.4" stroke="var(--gdb-icblue)" stroke-width="1.4" stroke-linecap="round"/>' +
    "</svg>",

  // IA: destellos en violeta (icpurple, el color que JetBrains asocia a la IA en la New UI; sus SVG de IA
  // no llevan cabecera Apache y no se pueden importar, de ahí que este sea propio).
  ai:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M6.4 1.8L7.65 5.55L11.4 6.8L7.65 8.05L6.4 11.8L5.15 8.05L1.4 6.8L5.15 5.55L6.4 1.8Z" fill="var(--gdb-icpurple)"/>' +
    '<path d="M12 9.2L12.75 11.45L15 12.2L12.75 12.95L12 15.2L11.25 12.95L9 12.2L11.25 11.45L12 9.2Z" fill="var(--gdb-icpurple)"/>' +
    "</svg>",

  // Filtro (fase 13, R38): el embudo de la fila de filtros y su interruptor. Es propio por una razón
  // medida, no por gusto: `expui/general/filter.svg` SÍ existe y tiene cabecera Apache 2.0, pero **no
  // tiene variante `_dark`** (HTTP 404 en el commit fijado), y el importador exige el par claro/oscuro
  // para deducir el rol de color. Se dibuja aquí con la misma gramática (trazo de 1 px, unión redonda)
  // y el rol que le correspondería: `icstroke`.
  filter:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12.75 2.75H3.25L6.75 7.5V13.25L9.25 12V7.5L12.75 2.75Z" stroke="var(--gdb-icstroke)" stroke-linejoin="round"/>' +
    "</svg>",
} as const;

export type CustomIconName = keyof typeof CUSTOM_ICONS;

/**
 * Motivo de cada icono propio, para el manifiesto (MANIFEST.md, sección «origen: propio»). Una sola fuente de verdad
 * para el papel y el código: el importador lee este mapa al generar el manifiesto.
 */
export const CUSTOM_ICON_ORIGIN: Record<CustomIconName, string> = {
  database: "base de datos / data source (el set abierto no lo trae: plugin Database cerrado)",
  view: "vista (misma mesa que nodes/dataSchema, con ojo azul en vez de lupa)",
  procedure: "procedimiento almacenado (círculo + glifo, como nodes/function pero azul)",
  trigger: "trigger (rayo amarillo)",
  primaryKey: "badge de clave primaria (llave amarilla, cuadrante inferior-derecho)",
  foreignKey: "badge de clave foránea (eslabón azul, cuadrante inferior-derecho)",
  explainPlan: "Explain plan (árbol de plan; sustituye al velocímetro de lucide)",
  connect: "conectar (enchufe)",
  disconnect: "desconectar (enchufe cortado en rojo)",
  console: "consola SQL (terminal con prompt >_)",
  ai: "IA (destellos violeta; los SVG de IA de JetBrains no llevan cabecera Apache 2.0)",
  filter:
    "embudo de la fila de filtros (expui/general/filter.svg no tiene variante _dark, y el importador exige el par)",
};
