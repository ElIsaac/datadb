/**
 * Opciones del panel nativo de archivos (fase 80).
 *
 * Vive aparte de `main` para poder probarlo: `dialog` no existe fuera de Electron, pero las
 * opciones que se le pasan son datos puros y ahí están las dos decisiones que se rompen en silencio:
 *
 *  - **`showHiddenFiles`**: las claves SSH y muchas CA viven en `~/.ssh` o en carpetas ocultas. Sin
 *    esta propiedad el panel las esconde y el usuario concluye que «no puede elegir su archivo».
 *  - **`filters`**: se construyen a partir de las extensiones que pide el campo (`pem`, `crt`, `key`…).
 *    Un filtro mal formado hace que macOS muestre TODOS los archivos en gris (ninguno seleccionable),
 *    que es peor que no filtrar.
 */

export interface OpcionesDeArchivo {
  title?: string;
  properties: Array<"openFile" | "showHiddenFiles" | "treatPackageAsDirectory">;
  filters?: Array<{ name: string; extensions: string[] }>;
}

/**
 * Normaliza lo que llega del renderer. Las extensiones se aceptan con o sin punto (`".pem"` o
 * `"pem"`), en minúsculas y sin duplicados; una extensión vacía o con caracteres raros se descarta
 * en vez de romper el filtro.
 */
export function normalizarExtensiones(entradas: unknown): string[] {
  if (!Array.isArray(entradas)) return [];
  const vistas = new Set<string>();
  for (const e of entradas) {
    if (typeof e !== "string") continue;
    const limpia = e.trim().replace(/^\.+/, "").toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(limpia)) continue;
    vistas.add(limpia);
  }
  return [...vistas];
}

export function opcionesDeArchivo(titulo?: string, extensiones: string[] = []): OpcionesDeArchivo {
  const exts = normalizarExtensiones(extensiones);
  const opciones: OpcionesDeArchivo = {
    // `openFile` es obligatorio: sin él el panel abre una carpeta y devuelve rutas de directorio,
    // que el driver luego intenta leer como PEM y falla con un error de lectura confuso.
    properties: ["openFile", "showHiddenFiles"],
  };
  if (titulo && titulo.trim()) opciones.title = titulo.trim();
  if (exts.length) {
    opciones.filters = [
      { name: "Archivos", extensions: exts },
      // Un segundo filtro con todo: en macOS el usuario puede querer un archivo sin extensión.
      { name: "Todos", extensions: ["*"] },
    ];
  }
  return opciones;
}
