import type { AiRequest } from "@/lib/ai-types";

export type SqlDialect = "postgres" | "mysql" | "sqlserver";
export type AiDialect = SqlDialect | "mongodb";

const DIALECT_LABEL: Record<AiDialect, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlserver: "SQL Server (Transact-SQL / T-SQL)",
  mongodb: "MongoDB (MQL / Aggregation Pipeline)",
};

export function buildMessages(
  req: AiRequest,
  schemaContext: string,
  dialect: AiDialect,
  readOnly = false
): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [
    { role: "system", content: buildSystemPrompt(dialect, readOnly, req.task) },
    { role: "user", content: schemaContext },
  ];

  if (req.task === "chat" && req.history) {
    for (const h of req.history) {
      messages.push({ role: h.role, content: h.content });
    }
  }

  messages.push({ role: "user", content: userPromptForTask(req, dialect) });
  return messages;
}

function buildSystemPrompt(
  dialect: AiDialect,
  readOnly: boolean,
  task: AiRequest["task"]
): string {
  const isMongo = dialect === "mongodb";
  const lines = [
    isMongo
      ? "Eres un asistente experto en MongoDB embebido en DataDB, un cliente de bases de datos."
      : "Eres un asistente experto en SQL embebido en DataDB, un cliente de bases de datos.",
    isMongo
      ? `El motor activo es **${DIALECT_LABEL[dialect]}**.`
      : `El dialecto SQL activo es **${DIALECT_LABEL[dialect]}**.`,
    "Tienes a continuación un contexto de esquema. Úsalo **exclusivamente**: si algo no está en el esquema, dilo explícitamente en vez de inventarlo.",
    "Responde en el **mismo idioma** en el que te escriba el usuario.",
    isMongo
      ? "La base de datos activa es MongoDB (NO SQL). Responde con consultas de MongoDB (`db.collection.find(...)`, `db.collection.aggregate([...])`) dentro de bloques ```javascript o ```json en lugar de SQL."
      : "Cuando produzcas código SQL, envuélvelo en un único bloque ```sql. No pongas explicaciones dentro del bloque.",
    isMongo
      ? "No sugieras operaciones destructivas (`drop`, `dropDatabase`, `deleteMany({})`) salvo que el usuario lo pida de forma inequívoca; si lo hace, advierte del riesgo."
      : "No sugieras DROP, TRUNCATE ni DELETE sin WHERE salvo que el usuario lo pida de forma inequívoca; si lo hace, advierte del riesgo.",
    readOnly
      ? isMongo
        ? "Esta conexión es de **solo lectura** (read-only), así que no generes operaciones de escritura (`insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `drop`)."
        : "Esta conexión es de **solo lectura** (read-only), así que no generes INSERT, UPDATE, DELETE ni DDL."
      : "",
    task === "chat"
      ? "En el chat, da respuestas completas y bien desarrolladas: explica el razonamiento, cubre casos relevantes (índices, alternativas, edge cases) y usa Markdown (listas, tablas, negritas) cuando ayude a la claridad. No seas telegráfico ni recortes la explicación por brevedad."
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function userPromptForTask(
  req: AiRequest,
  dialect: AiDialect
): string {
  switch (req.task) {
    case "chat":
      if (req.sql?.trim()) {
        return `Active SQL in editor:\n\`\`\`sql\n${req.sql.trim()}\n\`\`\`\n\nUser request:\n${req.prompt ?? ""}`;
      }
      return req.prompt ?? "";
    case "text-to-sql":
      return [
        "Genera una consulta SQL para el siguiente pedido:",
        req.prompt ?? "",
        `Dialecto: ${DIALECT_LABEL[dialect]}. Devuelve **solo** el bloque SQL, sin prosa previa.`,
      ].join("\n");
    case "explain-sql":
      return [
        "Explica qué hace esta consulta SQL de forma concisa:",
        "```sql",
        req.sql ?? "",
        "```",
      ].join("\n");
    case "convert-sql":
      return [
        `Convierte esta consulta de ${DIALECT_LABEL[dialect]} a ${DIALECT_LABEL[req.targetDialect ?? (dialect === "postgres" ? "mysql" : "postgres")]}.`,
        "```sql",
        req.sql ?? "",
        "```",
        "Devuelve el SQL convertido en un bloque ```sql y una breve nota sobre los cambios clave.",
      ].join("\n");
    case "fix-sql":
      return [
        "Corrige el siguiente error en esta consulta SQL.",
        "```sql",
        req.sql ?? "",
        "```",
        "Error:",
        req.errorMessage ?? "",
        "Explica en una línea qué estaba mal y luego devuelve el SQL corregido en un bloque ```sql.",
      ].join("\n");
    case "optimize-sql":
      return [
        "Optimiza la siguiente consulta SQL.",
        "```sql",
        req.sql ?? "",
        "```",
        "Plan de ejecución:",
        req.explainPlan ?? "",
        "Responde en tres secciones: Diagnóstico, Índices sugeridos (DDL), SQL reescrito (bloque ```sql).",
      ].join("\n");
    case "summarize-rows":
      return [
        "El usuario ha autorizado explícitamente el envío de estas filas reales de un result set.",
        `Columnas: ${(req.columns ?? []).join(", ")}`,
        "Filas (JSON):",
        "```json",
        JSON.stringify(req.rows ?? [], null, 2),
        "```",
        req.prompt
          ? `Petición del usuario sobre estos datos: ${req.prompt}`
          : "Resume estos datos: patrones, valores atípicos, rangos y cualquier observación relevante. No repitas la tabla completa.",
      ].join("\n");
    case "generate-aggregate":
      return [
        "Genera una consulta SQL de agregación o un snippet de transformación de datos, usando el esquema real.",
        req.tableName ? `Tabla de referencia: ${req.tableName}.` : "",
        req.columns && req.columns.length > 0
          ? `Columnas disponibles en el result set actual: ${req.columns.join(", ")}.`
          : "",
        `Petición: ${req.prompt ?? ""}`,
        `Dialecto: ${DIALECT_LABEL[dialect]}. Devuelve el SQL en un bloque \`\`\`sql. Si conviene, añade una nota breve fuera del bloque.`,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return req.prompt ?? "";
  }
}
