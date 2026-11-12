/**
 * Campo de credencial de IA en Ajustes (fase 25, T2; R8 y decisiones D2/D4/D7 del PLAN).
 *
 * Qué hace y qué NO:
 *  - Escribir la key y Guardar → canal `secrets:set` (lo atiende `main`, que la cifra con `safeStorage`). El campo se
 *    vacía al guardar: la key no se queda en el estado de React ni se vuelve a mostrar nunca.
 *  - La UI no puede LEER la key: solo sabe si hay una y de dónde sale (Ajustes cifrado o variable de entorno de
 *    desarrollo). Ni siquiera los últimos caracteres cruzan al renderer (D7).
 *  - Probar → canal del worker que llama al proveedor con la key guardada (sin gastar tokens) y dice si es válida.
 *  - Si el cifrado del sistema no está disponible no se ofrece Guardar: DataDB nunca guarda en claro (D4).
 *
 * Se reutiliza para cada proveedor (T3/T4): cambia el nombre del secreto, la etiqueta y si la key es opcional.
 */
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IjIcon } from "@/components/ij-icon";
import { invoke } from "@/lib/ipc-client";
import type { SecretName } from "@/shared/secrets";

export interface AiKeyFieldProps {
  secretName: SecretName;
  /** p. ej. «API key de OpenRouter». */
  label: string;
  /** De dónde sale hoy la key (viene de `ai:getSettings`). */
  source: "settings" | "env" | null;
  /** Nombre de la variable de entorno de respaldo en desarrollo, para decirlo en la UI. */
  envVar?: string;
  /** Con modelos locales (Ollama/LM Studio) la key no hace falta. */
  optional?: boolean;
  /** Si se puede «Probar» (el proveedor expone una forma de validar la key). */
  testable?: boolean;
  placeholder?: string;
  /** Tras guardar o borrar: el diálogo vuelve a pedir los ajustes para actualizar el estado. */
  onChanged: () => void;
}

export function AiKeyField({
  secretName,
  label,
  source,
  envVar,
  optional,
  testable = true,
  placeholder = "Pega aquí la key",
  onChanged,
}: AiKeyFieldProps) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [test, setTest] = React.useState<{ ok: boolean; message: string } | null>(null);
  // Fase 5 (T4): nombre de app anterior si ESTA key se perdió al renombrar el producto. Ver abajo.
  const [perdidaAlRenombrar, setPerdidaAlRenombrar] = React.useState<string | null>(null);

  React.useEffect(() => {
    invoke("secrets:status")
      .then((s) => {
        setAvailable(s.available);
        // El aviso solo se pinta en el campo del proveedor afectado, no en los tres.
        setPerdidaAlRenombrar(s.migration?.secrets.includes(secretName) ? s.migration.from : null);
      })
      .catch((err) => {
        console.error("[ai-key] No se pudo consultar el almacén de secretos", err);
        setAvailable(false);
      });
  }, [secretName]);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    setTest(null);
    try {
      await invoke("secrets:set", { name: secretName, value });
      setValue(""); // la key no se queda en el estado de la UI
      toast.success("Key guardada, cifrada en el Llavero de macOS");
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setTest(null);
    try {
      await invoke("secrets:delete", { name: secretName });
      toast.success("Key borrada");
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    try {
      setTest(await invoke("ai:testKey"));
    } catch (err) {
      setTest({ ok: false, message: String(err) });
    } finally {
      setBusy(false);
    }
  }

  const status =
    source === "settings"
      ? { tone: "ok", text: "Guardada en Ajustes (cifrada)" }
      : source === "env"
        ? { tone: "ok", text: `Desde la variable de entorno ${envVar ?? ""} (solo en desarrollo)` }
        : optional
          ? { tone: "muted", text: "Sin key (no hace falta con modelos locales)" }
          : { tone: "warn", text: "No configurada" };

  return (
    <div data-testid={`ai-key-${secretName}`} className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">{label}</span>
        <span
          data-testid="ai-key-status"
          className={
            status.tone === "ok"
              ? "flex items-center gap-1.5 text-gdb-okfg"
              : status.tone === "warn"
                ? "flex items-center gap-1.5 text-gdb-warnfg"
                : "flex items-center gap-1.5 text-muted-foreground"
          }
        >
          <IjIcon name={status.tone === "ok" ? "success" : status.tone === "warn" ? "warning" : "locked"} />
          {status.text}
        </span>
      </div>

      {/*
        Fase 5 (T4). Al renombrar el producto, `safeStorage` pasó a usar otro ítem del Keychain y los blobs viejos
        quedaron ilegibles para siempre (medido, no supuesto: ver el spike de T1 en el PLAN de la fase 5). La regla es
        que eso NUNCA falle en silencio: en vez de un error de descifrado a mitad de una petición de IA, el campo
        afectado lo dice aquí. El aviso se apaga solo en cuanto se guarda una key nueva.
      */}
      {perdidaAlRenombrar && (
        <p data-testid="ai-key-renombre" className="flex items-start gap-1.5 text-gdb-warnfg">
          <IjIcon name="warning" />
          <span>
            La app se llamaba «{perdidaAlRenombrar}» y ahora se llama DataDB. El Llavero de macOS guarda su clave de
            cifrado bajo el nombre de la app, así que la key anterior ya no se puede leer: escríbela otra vez aquí
            abajo. Es cosa de una sola vez.
          </span>
        </p>
      )}

      {available === false ? (
        <p className="text-gdb-warnfg">
          El cifrado del sistema (Llavero) no está disponible: no se puede guardar la key. DataDB nunca guarda una
          credencial en texto plano.
        </p>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={source === "settings" ? "Escribe una key nueva para reemplazarla" : placeholder}
            className="h-8 flex-1 font-mono text-xs"
            aria-label={label}
          />
          <Button type="submit" size="sm" disabled={busy || !value.trim() || available === null}>
            <IjIcon name="locked" />
            {source === "settings" ? "Reemplazar" : "Guardar"}
          </Button>
          {testable && (
            <Button type="button" size="sm" variant="outline" disabled={busy || source === null} onClick={() => void runTest()}>
              Probar
            </Button>
          )}
          {source === "settings" && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove()} title="Borrar la key guardada">
              <IjIcon name="delete" />
              Borrar
            </Button>
          )}
        </form>
      )}

      {test && (
        <p data-testid="ai-key-test" className={test.ok ? "text-gdb-okfg" : "text-gdb-errfg"}>
          {test.message}
        </p>
      )}
    </div>
  );
}
