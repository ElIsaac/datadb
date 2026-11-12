/**
 * Validacion del remitente de un mensaje IPC. `main` es la UNICA frontera de confianza
 * entre el renderer y el db-worker: si un frame ajeno (navegacion inesperada, iframe) llegara
 * a invocar un canal, se rechaza antes de tocar un driver.
 *
 * Funcion pura para poder probarla sin Electron.
 */
export function isTrustedSenderUrl(
  url: string | undefined | null,
  rendererDevUrl: string | undefined
): boolean {
  if (!url) return false;
  if (rendererDevUrl) {
    // Origen exacto: "http://localhost:5173" no debe aceptar "http://localhost:5173.evil.com".
    const origin = new URL(rendererDevUrl).origin;
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  }
  return url.startsWith("file://");
}
