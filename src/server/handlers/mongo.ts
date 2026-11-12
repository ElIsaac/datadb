/**
 * Handlers de la vista de documentos de MongoDB (fase 81).
 *
 * Los dos comprueban que la sesión exista Y que su driver sea de Mongo: una consola de Postgres no
 * puede atender `mongo:find` y el error tiene que decirlo, no lanzar un `undefined.findDocuments`
 * (que es lo que saldría si se llamara al driver SQL).
 */
import { HandlerError } from "./errors";
import { getSession } from "@/server/sessions";
import { MongodbDriver } from "@/server/db/mongodb";
import type { InvokeMap } from "@/shared/contract";

function driverMongo(sessionId: string): MongodbDriver {
  if (!sessionId) throw new HandlerError("Falta el id de sesión", 400);
  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 404);
  if (!(stored.driver instanceof MongodbDriver)) {
    throw new HandlerError("Esta conexión no es de MongoDB", 400);
  }
  return stored.driver;
}

export async function mongoFindHandler(
  body: InvokeMap["mongo:find"]["req"]
): Promise<InvokeMap["mongo:find"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  return driver.findDocuments(body.coleccion, {
    filtro: body.filtro,
    proyeccion: body.proyeccion,
    orden: body.orden,
    skip: body.skip,
    limit: body.limit,
  });
}

export async function mongoCountHandler(
  body: InvokeMap["mongo:count"]["req"]
): Promise<InvokeMap["mongo:count"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  return driver.countDocuments(body.coleccion, body.filtro);
}

export async function mongoFieldsHandler(
  body: InvokeMap["mongo:fields"]["req"]
): Promise<InvokeMap["mongo:fields"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  return { campos: await driver.sampleFields(body.coleccion) };
}

export async function mongoUpdateHandler(
  body: InvokeMap["mongo:update"]["req"]
): Promise<InvokeMap["mongo:update"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  if (body.id === undefined || body.id === null) throw new HandlerError("Falta el _id del documento", 400);
  if (!body.cambios || typeof body.cambios !== "object" || Object.keys(body.cambios).length === 0) {
    throw new HandlerError("No hay cambios que guardar", 400);
  }
  return driver.updateDocument(body.coleccion, body.id, body.cambios, body.antes ?? {});
}

export async function mongoInsertHandler(
  body: InvokeMap["mongo:insert"]["req"]
): Promise<InvokeMap["mongo:insert"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  if (!body.documento || typeof body.documento !== "object") {
    throw new HandlerError("Falta el documento a insertar", 400);
  }
  return driver.insertDocument(body.coleccion, body.documento);
}

export async function mongoDeleteHandler(
  body: InvokeMap["mongo:delete"]["req"]
): Promise<InvokeMap["mongo:delete"]["res"]> {
  const driver = driverMongo(body?.sessionId);
  if (!body?.coleccion) throw new HandlerError("Falta la colección", 400);
  if (body.id === undefined || body.id === null) throw new HandlerError("Falta el _id del documento", 400);
  return driver.deleteDocument(body.coleccion, body.id);
}
