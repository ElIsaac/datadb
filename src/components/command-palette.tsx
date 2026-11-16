import * as React from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { useAppState, useAppDispatch } from "@/hooks/use-app-state";
import { showToolWindow } from "@/shell/layout-store";
import { TerminalIcon, UnplugIcon, TableIcon, HistoryIcon, SparklesIcon, MessageSquareIcon, SettingsIcon, FileQuestionIcon, CodeIcon, Wand2Icon, LanguagesIcon } from "lucide-react";

interface CommandPaletteProps {
  onDisconnect: () => void;
}

export function CommandPalette({ onDisconnect }: CommandPaletteProps) {
  const { schema, commandOpen, tableTabs } = useAppState();
  const dispatch = useAppDispatch();

  /*
    Fase 15 (T5): aquí vivía un `keydown` de `window` con `⌘K` que DUPLICABA el acelerador del menú
    (y, desde T3, el alias del registro). Se borró: quien abre la paleta ahora es el ENRUTADOR de
    teclado (`src/shell/keyboard-router.ts`), que sirve `⌘K` en cualquier contexto por el camino
    único de `ejecutarAccionDeMenu("view.commandPalette")` → evento `gestordb:command-palette` → el
    armazón (el mismo camino que el menú nativo). Con la paleta abierta, el enrutador no actúa (hay
    un `[role="dialog"]`), así que `⌘K` se comporta como hoy: la paleta sigue abierta.
  */

  const tables = React.useMemo(() => {
    const list: { schema: string; table: string; label: string }[] = [];
    if (!schema) return list;
    for (const node of schema) {
      for (const table of node.tables) {
        list.push({
          schema: node.name,
          table: table.name,
          label: `${node.name}.${table.name}`,
        });
      }
    }
    return list;
  }, [schema]);

  const recentTables = React.useMemo(() => {
    return tableTabs
      .filter((tab) => tab.kind !== "sqlLog") // el log no es una tabla (fase 3, T7)
      .slice(-5)
      .reverse()
      .map((tab) => ({
        schema: tab.target.schema,
        table: tab.target.table,
        label: tab.id,
      }));
  }, [tableTabs]);

  function openSqlTab() {
    dispatch({ type: "SET_ACTIVE_TAB", payload: "sql" });
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
  }

  function openHistory() {
    showToolWindow("history");
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
  }

  function openTable(schema: string, table: string) {
    dispatch({
      type: "OPEN_TABLE_TAB",
      payload: { schema, table },
    });
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
  }

  function disconnect() {
    onDisconnect();
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
  }

  /**
   * Spike F2-B: abre la DEMO del editor propio a pantalla completa (con su esquema de ejemplo y su
   * botón de 10 000 líneas). Es la sala de pruebas; la consola conmuta con la otra acción.
   */
  function openOwnEditorDemo() {
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
    setTimeout(() => window.dispatchEvent(new CustomEvent("gdb:spike-editor")), 80);
  }

  // Los diálogos de IA viven dentro de SqlEditor: primero cambiamos a la
  // pestaña SQL y luego disparamos el evento una vez montada.
  function dispatchAiEvent(name: string) {
    dispatch({ type: "SET_ACTIVE_TAB", payload: "sql" });
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
    setTimeout(() => window.dispatchEvent(new CustomEvent(name)), 80);
  }

  function openAiChat() {
    showToolWindow("ai");
    dispatch({ type: "SET_COMMAND_OPEN", payload: false });
  }

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={(open) => dispatch({ type: "SET_COMMAND_OPEN", payload: open })}
      className="top-1/3 max-w-lg w-full overflow-hidden border border-border bg-popover p-0 shadow-2xl"
    >
      <CommandInput
        placeholder="Buscar tablas, acciones..."
        wrapperClassName="p-3 pb-0"
        inputGroupClassName="h-12! rounded-xl! border-border/30 bg-muted/40"
        className="text-base placeholder:text-muted-foreground"
      />
      <CommandList className="px-2 pb-2">
        <CommandEmpty className="py-6 text-sm text-muted-foreground">
          No se encontraron resultados.
        </CommandEmpty>

        <CommandGroup heading="Acciones" className="text-xs font-medium text-muted-foreground">
          <CommandItem
            onSelect={openSqlTab}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <TerminalIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">Ir a consola SQL</span>
            <kbd className="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px]">⌘1</kbd>
          </CommandItem>
          <CommandItem
            onSelect={openHistory}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <HistoryIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">Abrir historial</span>
            <kbd className="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px]">⌘⇧H</kbd>
          </CommandItem>
          <CommandItem
            onSelect={openOwnEditorDemo}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <CodeIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">Abrir editor propio (demo)</span>
            <kbd className="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px]">F2-B</kbd>
          </CommandItem>
          <CommandItem
            onSelect={disconnect}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <UnplugIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">Desconectar</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator className="my-1 bg-border/50" />
        <CommandGroup heading="IA" className="text-xs font-medium text-muted-foreground">
          <CommandItem
            onSelect={() => dispatchAiEvent("gestordb:ai-sql")}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <SparklesIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Generar SQL…</span>
            <kbd className="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px]">⌘⇧Y</kbd>
          </CommandItem>
          <CommandItem
            onSelect={() => dispatchAiEvent("gestordb:ai-explain")}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <FileQuestionIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Explicar statement activo</span>
          </CommandItem>
          <CommandItem
            onSelect={() => dispatchAiEvent("gestordb:ai-lint-fix")}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <Wand2Icon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Corregir statement activo (linter)</span>
          </CommandItem>
          <CommandItem
            onSelect={() => dispatchAiEvent("gestordb:ai-convert")}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <LanguagesIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Convertir SQL a otro dialecto…</span>
          </CommandItem>
          <CommandItem
            onSelect={openAiChat}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <MessageSquareIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Abrir chat</span>
          </CommandItem>
          <CommandItem
            onSelect={() => dispatchAiEvent("gestordb:ai-settings")}
            className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
          >
            <SettingsIcon className="size-4 shrink-0" />
            <span className="flex-1 text-sm">IA: Ajustes</span>
          </CommandItem>
        </CommandGroup>

        {recentTables.length > 0 && (
          <>
            <CommandSeparator className="my-1 bg-border/50" />
            <CommandGroup heading="Tablas recientes" className="text-xs font-medium text-muted-foreground">
              {recentTables.map((item) => (
                <CommandItem
                  key={`recent-${item.label}`}
                  value={item.label}
                  onSelect={() => openTable(item.schema, item.table)}
                  className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
                >
                  <TableIcon className="size-4 shrink-0" />
                  <span className="flex-1 truncate text-sm">{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {tables.length > 0 && (
          <>
            <CommandSeparator className="my-1 bg-border/50" />
            <CommandGroup heading="Todas las tablas" className="text-xs font-medium text-muted-foreground">
              {tables.map((item) => (
                <CommandItem
                  key={item.label}
                  value={item.label}
                  onSelect={() => openTable(item.schema, item.table)}
                  className="gap-3 rounded-lg px-3 py-2.5 data-selected:bg-primary/15 data-selected:text-primary"
                >
                  <TableIcon className="size-4 shrink-0" />
                  <span className="flex-1 truncate text-sm">{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
