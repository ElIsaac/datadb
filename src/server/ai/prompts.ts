import type { AiRequest } from "@/lib/ai-types";

type SqlDialect = "postgres" | "mysql" | "sqlserver";

export function buildMessages(
  req: AiRequest,
  schemaContext: string,
  dialect: SqlDialect,
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
  dialect: SqlDialect,
  readOnly: boolean,
  task: AiRequest["task"]
): string {
  const lines = [
    "Eres un asistente experto en SQL embebido en DataDB, un cliente de bases de datos.",
    `El dialecto SQL activo es **${dialect}**${dialect === "sqlserver" ? " (Transact-SQL / T-SQL)" : ""}.`,
    "Tienes a continuación un contexto de esquema. Úsalo **exclusivamente**: si algo no está en el esquema, dilo explícitamente en vez de inventarlo.",
    "Responde en el **mismo idioma** en el que te escriba el usuario.",
    "Cuando produzcas código SQL, envuélvelo en un único bloque ```sql. No pongas explicaciones dentro del bloque.",
    "No sugieras DROP, TRUNCATE ni DELETE sin WHERE salvo que el usuario lo pida de forma inequívoca; si lo hace, advierte del riesgo.",
    readOnly
      ? "Esta conexión es de **solo lectura** (read-only), así que no generes INSERT, UPDATE, DELETE ni DDL."
      : "",
    task === "chat"
      ? "En el chat, da respuestas completas y bien desarrolladas: explica el razonamiento, cubre casos relevantes (índices, JOINs alternativos, edge cases) y usa Markdown (listas, tablas, negritas) cuando ayude a la claridad. No seas telegráfico ni recortes la explicación por brevedad."
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function userPromptForTask(
  req: AiRequest,
  dialect: SqlDialect
): string {
  switch (req.task) {
    case "chat":
      return req.prompt ?? "";
    case "text-to-sql":
      return [
        "Genera una consulta SQL para el siguiente pedido:",
        req.prompt ?? "",
        `Dialecto: ${dialect}. Devuelve **solo** el bloque SQL, sin prosa previa.`,
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
        `Convierte esta consulta de ${dialect} a ${req.targetDialect ?? (dialect === "postgres" ? "mysql" : "postgres")}.`,
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
        `Dialecto: ${dialect}. Devuelve el SQL en un bloque \`\`\`sql. Si conviene, añade una nota breve fuera del bloque.`,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return req.prompt ?? "";
  }
}
