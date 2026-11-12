/**
 * `openBinding` (R91) con las llamadas reales al worker. Vive aparte de `console-binding.ts` para que
 * los tests de lo puro no arrastren el cliente IPC; los componentes usan esta.
 */
import { connect, switchDatabase } from "@/lib/api";
import { openBinding } from "@/lib/console-binding";
import type { ConsoleBinding, Session } from "@/lib/types";

export function wakeBinding(
  binding: Pick<ConsoleBinding, "profileId" | "database">
): Promise<{ session: Session; databaseError?: string }> {
  return openBinding(binding, { connect: (id) => connect(id), switchDatabase });
}
