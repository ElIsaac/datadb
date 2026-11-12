import { promises as fs } from "fs";
import type { ChatMessage } from "@/lib/ai-types";
// Fase 5 (R2): el directorio de datos lo resuelve el único módulo src/server/data-dir.ts.
import { DATA_DIR, dataPath } from "../data-dir";

const AI_CHATS_PATH = dataPath("aiChats");
const MAX_MESSAGES_PER_CONNECTION = 50;

type AiChatsFile = Record<string, ChatMessage[]>;

async function readFile(): Promise<AiChatsFile> {
  try {
    const raw = await fs.readFile(AI_CHATS_PATH, "utf-8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AiChatsFile) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeFile(data: AiChatsFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${AI_CHATS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, AI_CHATS_PATH);
}

/** Historial del chat de IA por conexión (misma clave que las saved queries). */
export async function loadAiChatHistory(connectionId: string): Promise<ChatMessage[]> {
  if (!connectionId) return [];
  const data = await readFile();
  return data[connectionId] ?? [];
}

export async function saveAiChatHistory(
  connectionId: string,
  messages: ChatMessage[]
): Promise<ChatMessage[]> {
  if (!connectionId) return messages;
  const data = await readFile();
  const trimmed = messages.slice(-MAX_MESSAGES_PER_CONNECTION);
  data[connectionId] = trimmed;
  await writeFile(data);
  return trimmed;
}

export async function clearAiChatHistory(connectionId: string): Promise<void> {
  if (!connectionId) return;
  const data = await readFile();
  delete data[connectionId];
  await writeFile(data);
}
