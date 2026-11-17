import { readFileSync } from "node:fs";
import { normalizarTls, problemasDeRed, type TlsConfig } from "@/shared/connection-net";

export interface OpcionesSsl {
  rejectUnauthorized: boolean;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  servername?: string;
}

/** `ssl` para `pg` y `mysql2` (ambos lo pasan tal cual a `tls.connect`); `undefined` = sin TLS. */
export function sslParaDriver(entrada: TlsConfig | undefined): OpcionesSsl | undefined {
  const tls = normalizarTls(entrada);
  if (tls.mode === "deshabilitado") return undefined;
  const problemas = problemasDeRed(tls, undefined);
  if (problemas.length) throw new Error(problemas.join("; "));
  return {
    rejectUnauthorized: tls.mode !== "requerido",
    ...(tls.caFile ? { ca: readFileSync(tls.caFile) } : {}),
    ...(tls.mode === "mutuo" && tls.certFile ? { cert: readFileSync(tls.certFile) } : {}),
    ...(tls.mode === "mutuo" && tls.keyFile ? { key: readFileSync(tls.keyFile) } : {}),
    ...(tls.serverName ? { servername: tls.serverName } : {}),
  };
}
