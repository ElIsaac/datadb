/**
 * R101 — el botón «Conectar» disponible en CUALQUIER vista, no sólo dentro del modal «Conexiones…».
 *
 * Por qué existe: el worker cierra las sesiones inactivas a los 10 minutos, y cuando eso pasa no
 * había forma de reconectar desde una pestaña de tabla o desde la barra superior sin abrir el modal
 * de conexiones. Este hook centraliza la reconexión de la consola CON FOCO usando su atadura (la
 * `binding` guardada, o la que se deduce de su sesión viva). Esa lógica hoy vive duplicada en
 * `console-connection-bar.tsx`, `app-top-bar.tsx` y `app-shell.tsx` — no se desduplican aquí (son
 * otras fases), sólo se evita añadir una cuarta copia.
 *
 * Por qué reusa `wakeBinding` (que envuelve `openBinding`, R91): reconectar no es sólo «conectar el
 * perfil», es volver a la BASE que la consola tenía guardada — que puede no ser la de fábrica del
 * perfil. Reconectar por el camino corto perdía la base; por éste no.
 */
import * as React from "react";
import { toast } from "sonner";
import { bindingParaConectar, connectionOf } from "@/lib/console-binding";
import { wakeBinding } from "@/lib/console-wake";
import { useActiveConsole, useAppDispatch } from "@/hooks/use-app-state";

export function useConectarConsola(): {
  /** `true` si llegó a conectar (o ya estaba conectada). */
  conectar: () => Promise<boolean>;
  conectando: boolean;
  /** La conexión pintable de la consola con foco (viva o dormida). */
  conexion: ReturnType<typeof connectionOf>;
} {
  const activeConsole = useActiveConsole();
  const dispatch = useAppDispatch();
  const [conectando, setConectando] = React.useState(false);

  // Misma fuente que pintan la barra y el desplegable: viva o dormida (atadura).
  const conexion = connectionOf(activeConsole);

  const conectar = React.useCallback(async (): Promise<boolean> => {
    // Ya viva no se toca nada: reconectar mataría la sesión (y el resultado en pantalla) por gusto.
    if (activeConsole.session) return true;

    const b = bindingParaConectar(activeConsole);
    if (!b) {
      // Sin atadura no hay a quién conectar: la consola nació huérfana y le toca elegir perfil.
      toast.error("La consola no está atada a ninguna conexión: elige un perfil en Conexiones…");
      return false;
    }

    setConectando(true);
    try {
      const { session, databaseError } = await wakeBinding(b);
      // La base guardada pudo borrarse de la otra parte: `wakeBinding` conecta igual contra la del
      // perfil pero informa el fallo — se conecta y se avisa, mejor que dejar la pestaña muda.
      if (databaseError) toast.warning(`No se pudo volver a la base ${b.database}: ${databaseError}`);
      dispatch({ type: "SET_SESSION", payload: { consoleId: activeConsole.id, session } });
      toast.success(`Consola conectada a ${session.name}`);
      return true;
    } catch (err) {
      toast.error(String(err));
      return false;
    } finally {
      setConectando(false);
    }
  }, [activeConsole, dispatch]);

  return { conectar, conectando, conexion };
}
