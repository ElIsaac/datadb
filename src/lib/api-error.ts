/**
 * Error de la capa de datos del cliente. Vive en su propio archivo para que api.ts y
 * ipc-client.ts lo compartan sin import circular. api.ts lo re-exporta (ai.ts lo importa de ahi).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}
