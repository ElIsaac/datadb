/**
 * Mide el coste real del contexto de esquema que se enviará al modelo de IA.
 *
 * Uso:
 *   npx tsx scripts/ai-context-preview.ts <profileId|profileName> [focusTabla]
 *
 * Conecta con el perfil, obtiene el esquema real y muestra:
 * - nº de esquemas / tablas / columnas
 * - contexto generado por buildSchemaContext y su longitud en caracteres
 *   (regla aproximada: ~4 chars por token → coste de prompt por request)
 */
import { loadProfiles } from "../src/server/profiles";
import { dialectoSql } from "../src/shared/connection-net";
import { createDriver } from "../src/server/db/factory";
import { buildSchemaContext } from "../src/server/ai/schema-context";
import { loadAiSettings } from "../src/server/ai/settings";

async function main() {
  const [selector, focusTable] = process.argv.slice(2);
  if (!selector) {
    console.error("Uso: npx tsx scripts/ai-context-preview.ts <profileId|nombre> [focusTabla]");
    process.exit(1);
  }

  const profiles = await loadProfiles();
  const profile = profiles.find((p) => p.id === selector || p.name === selector);
  if (!profile) {
    console.error(`Perfil no encontrado: ${selector}`);
    console.error("Disponibles:", profiles.map((p) => `${p.name} (${p.id})`).join(", "));
    process.exit(1);
  }

  const settings = await loadAiSettings();
  const driver = createDriver(profile);
  try {
    const schema = await driver.getSchema();
    const tables = schema.reduce((acc, n) => acc + n.tables.length, 0);
    const columns = schema.reduce(
      (acc, n) => acc + n.tables.reduce((a, t) => a + t.columns.length, 0),
      0
    );
    console.log(`Perfil: ${profile.name} (${profile.type}, db=${profile.database})`);
    console.log(`Esquema: ${schema.length} schemas, ${tables} tablas, ${columns} columnas`);

    const context = buildSchemaContext(schema, {
      budgetChars: settings.schemaBudgetChars,
      focusTables: focusTable ? [{ table: focusTable }] : [],
      dialect: dialectoSql(profile.type),
    });

    console.log(`\nBudget: ${settings.schemaBudgetChars} chars`);
    console.log(`Contexto generado: ${context.length} chars (~${Math.ceil(context.length / 4)} tokens)`);
    console.log("\n---8<--- contexto ---8<---\n");
    console.log(context);
  } finally {
    await driver.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
