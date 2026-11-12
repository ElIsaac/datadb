/**
 * Ajustes de IA. Fase 25 (R8, R24): proveedor activo (OpenRouter / compatible con OpenAI / gateway), su key cifrada
 * (`AiKeyField`), su URL base cuando aplica, y el modelo del catálogo de ESE proveedor.
 *
 * Decisiones que se ven aquí (PLAN de la fase 25):
 *  - D1: el proveedor «Compatible con OpenAI» lleva atajos de URL (OpenAI, DeepSeek, Groq, Ollama, LM Studio); con
 *    una URL local la key es opcional.
 *  - D7: la key nunca se muestra; solo su estado.
 *  - D8: el gateway se configura a mano (URL + token de sesión) mientras no haya backend.
 *  - D9: contexto y precio solo los publica OpenRouter; para el resto se muestra «—», no un 0 inventado.
 *
 * Cada cambio se guarda al momento (como antes); los campos de texto (URL, modelo a mano) al salir del campo, para
 * no escribir el archivo en cada tecla.
 */
import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/hooks/use-app-state";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getAiSettings, saveAiSettings, listAiModels, isModelAvailable, DEFAULT_AI_SETTINGS } from "@/lib/ai";
import { AiKeyField } from "@/components/ai-key-field";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  OPENAI_COMPATIBLE_PRESETS,
  activeModelOf,
  activeModelPatch,
  type AiModel,
  type AiProviderId,
  type AiSettings,
  type AiSettingsWithKeyStatus,
} from "@/lib/ai-types";
import { SparklesIcon, StarIcon, AlertTriangleIcon, SearchIcon, Trash2Icon, RotateCcwIcon, XIcon } from "lucide-react";

export interface AiSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEEPSEEK_DEFAULT = "deepseek/deepseek-chat-v3-0324";

const PROVIDER_HINTS: Record<AiProviderId, string> = {
  openrouter: "Cientos de modelos con una sola key. Muestra el coste real de cada respuesta.",
  openai: "Cualquier API compatible con OpenAI: OpenAI, DeepSeek, Groq o modelos locales (Ollama, LM Studio).",
  gateway: "Keys gestionadas por un servidor de DataDB (token de sesión). Avanzado: aún no hay servicio público.",
};

function formatPrice(perToken: number | undefined): string {
  if (perToken === undefined) return "—";
  if (!perToken) return "gratis";
  return `$${(perToken * 1_000_000).toFixed(2)}/1M`;
}

function formatContext(len: number | undefined): string {
  if (!len) return "—";
  if (len >= 1000) return `${Math.round(len / 1000)}K`;
  return String(len);
}

export function AiSettingsDialog({ open, onOpenChange }: AiSettingsDialogProps) {
  const dispatch = useAppDispatch();
  const [settings, setSettings] = React.useState<AiSettingsWithKeyStatus | null>(null);
  const [models, setModels] = React.useState<AiModel[]>([]);
  const [stale, setStale] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");

  /** Vuelve a pedir ajustes (estado de la key) y catálogo del proveedor activo, y los propaga a la app. */
  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, modelsData] = await Promise.all([getAiSettings(), listAiModels()]);
      setSettings(settingsData);
      setModels(modelsData.models);
      setStale(modelsData.stale);
      dispatch({ type: "SET_AI_SETTINGS", payload: settingsData });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (open) void reload();
  }, [open, reload]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!settings) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[min(94vw,42rem)] border-border/60 bg-popover p-0 text-foreground max-h-[90vh] overflow-y-auto sm:max-w-[min(94vw,42rem)]">
          <div className="flex items-center gap-3 border-b border-border/60 p-5">
            <span className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
              <SparklesIcon className="size-4 text-primary" />
            </span>
            <DialogTitle className="text-base font-semibold">Ajustes de IA</DialogTitle>
          </div>
          <div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>
        </DialogContent>
      </Dialog>
    );
  }

  const provider = settings.provider;
  const { model: activeModel, favoriteModels: favorites } = activeModelOf(settings);
  const modelAvailable = isModelAvailable(activeModel, models);
  const currentModel = models.find((m) => m.id === activeModel);

  /**
   * Guarda un parche. `refresh`: tras cambiar algo que altera el estado de la key o el catálogo (proveedor, URL),
   * se vuelven a pedir ambos.
   */
  function updateSettings(patch: Partial<AiSettings>, refresh = false) {
    const next = { ...settings!, ...patch } as AiSettingsWithKeyStatus;
    setSettings(next);
    // Propagar al estado global de inmediato (barra de estado, chat), fuera del updater de setState.
    dispatch({ type: "SET_AI_SETTINGS", payload: next });
    const clean: Record<string, unknown> = { ...patch };
    delete clean.hasApiKey;
    delete clean.keySource;
    delete clean.keyOptional;
    saveAiSettings(clean as Partial<AiSettings>)
      .then(() => (refresh ? reload() : undefined))
      .catch((err) => toast.error(String(err)));
  }

  function setModel(id: string) {
    updateSettings(activeModelPatch(settings!, { model: id }));
  }

  function toggleFavorite(modelId: string) {
    const next = favorites.includes(modelId) ? favorites.filter((m) => m !== modelId) : [modelId, ...favorites];
    updateSettings(activeModelPatch(settings!, { favoriteModels: next }));
  }

  function removeFavoriteAndFallback(modelId: string) {
    const change: { favoriteModels: string[]; model?: string } = { favoriteModels: favorites.filter((m) => m !== modelId) };
    if (activeModel === modelId && provider === "openrouter") change.model = DEEPSEEK_DEFAULT;
    updateSettings(activeModelPatch(settings!, change));
  }

  /** URL base del proveedor activo (openai | gateway), guardada al salir del campo o al elegir un atajo. */
  function setBaseUrl(baseUrl: string, model?: string) {
    if (provider === "openrouter") return;
    updateSettings({ [provider]: { ...settings![provider], baseUrl, ...(model ? { model } : {}) } } as Partial<AiSettings>, true);
  }

  const lowerSearch = search.trim().toLowerCase();
  const filteredModels = models.filter((m) => (lowerSearch ? `${m.id} ${m.name}`.toLowerCase().includes(lowerSearch) : true));
  const favoriteModels = filteredModels.filter((m) => favorites.includes(m.id)).sort((a, b) => a.id.localeCompare(b.id));
  const otherModels = filteredModels.filter((m) => !favorites.includes(m.id));

  function ModelRow({ model }: { model: AiModel }) {
    const isFav = favorites.includes(model.id);
    const isActive = activeModel === model.id;
    return (
      <button
        type="button"
        data-model-id={model.id}
        onClick={() => setModel(model.id)}
        className={cn(
          "group flex w-full items-center gap-4 px-4 py-3 text-left text-xs transition-colors border-b border-outline-variant/10",
          isActive
            ? "border-l-2 border-l-primary bg-surface-container-high/20"
            : "border-l-2 border-l-transparent hover:bg-surface-container-highest/40"
        )}
      >
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(model.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              toggleFavorite(model.id);
            }
          }}
          title={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
          className="shrink-0"
        >
          <StarIcon
            className={cn(
              "size-4 transition-colors",
              isFav ? "fill-gdb-warn text-gdb-warnfg" : "text-muted-foreground/50 group-hover:text-muted-foreground"
            )}
          />
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium text-foreground">{model.id}</span>
            {isActive && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary border border-primary/20">
                Activo
              </span>
            )}
          </div>
          {model.name !== model.id && <div className="truncate text-[12px] text-muted-foreground/70">{model.name}</div>}
        </div>
        <div className="flex items-center gap-6 text-muted-foreground/80 font-mono text-[12px] shrink-0">
          <div className="flex flex-col items-end w-[52px]">
            <span className="text-[10px] text-muted-foreground/50 uppercase">Contexto</span>
            <span>{formatContext(model.context_length)}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5 w-[110px]">
            <span className="text-[10px] text-muted-foreground/50 uppercase">Precio/1M</span>
            {model.pricing ? (
              <>
                <span className="whitespace-nowrap">in {formatPrice(model.pricing.prompt)}</span>
                <span className="whitespace-nowrap">out {formatPrice(model.pricing.completion)}</span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
      </button>
    );
  }

  const urlSettings = provider === "openrouter" ? null : settings[provider];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] max-w-[min(94vw,56rem)] flex-col overflow-hidden border-border/60 bg-popover p-0 text-foreground sm:max-w-[min(94vw,56rem)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
              <SparklesIcon className="size-4 text-primary" />
            </span>
            <div>
              <DialogTitle className="text-base font-semibold">Ajustes de IA</DialogTitle>
              <DialogDescription className="text-xs" data-testid="ai-active-provider">
                Proveedor: {AI_PROVIDER_LABELS[provider]}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              IA habilitada
              <button
                type="button"
                role="switch"
                id="enabled"
                aria-checked={settings.enabled}
                onClick={() => updateSettings({ enabled: !settings.enabled })}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                  settings.enabled ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
                    settings.enabled ? "left-4" : "left-0.5"
                  )}
                />
              </button>
            </label>
            <Button variant="ghost" size="icon-xs" onClick={() => onOpenChange(false)}>
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6">
          {/* Fase 25 (R24): proveedor activo. Cambiarlo recarga el estado de la key y el catálogo. */}
          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">Proveedor</Label>
            <div role="radiogroup" className="grid grid-cols-3 gap-2" data-testid="ai-provider-picker">
              {AI_PROVIDER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={provider === id}
                  data-provider={id}
                  onClick={() => provider !== id && updateSettings({ provider: id }, true)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                    provider === id
                      ? "border-primary bg-primary/10 font-semibold text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {AI_PROVIDER_LABELS[id]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{PROVIDER_HINTS[provider]}</p>
          </div>

          {/* URL base (compatible con OpenAI y gateway). */}
          {urlSettings && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ai-base-url" className="shrink-0 text-xs text-muted-foreground">
                  {provider === "gateway" ? "URL del gateway" : "URL base de la API"}
                </Label>
                {provider === "openai" && (
                  <div className="flex flex-wrap justify-end gap-1.5" data-testid="ai-url-presets">
                    {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                      <Button
                        key={p.label}
                        size="xs"
                        variant={urlSettings.baseUrl === p.baseUrl ? "secondary" : "outline"}
                        onClick={() => setBaseUrl(p.baseUrl, p.model)}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <Input
                id="ai-base-url"
                key={`${provider}:${urlSettings.baseUrl}`}
                defaultValue={urlSettings.baseUrl}
                placeholder={provider === "gateway" ? "https://gateway.ejemplo.com/v1" : "https://api.openai.com/v1"}
                spellCheck={false}
                className="h-8 font-mono text-xs"
                onBlur={(e) => e.target.value.trim() !== urlSettings.baseUrl && setBaseUrl(e.target.value.trim())}
              />
            </div>
          )}

          {/* Fase 25 (R8): key (o token) del proveedor activo, cifrada en main. */}
          {provider === "openrouter" && (
            <AiKeyField
              key="openrouter"
              secretName="ai.openrouter"
              label="API key de OpenRouter"
              source={settings.keySource}
              envVar="OPENROUTER_API_KEY"
              placeholder="sk-or-v1-…"
              onChanged={() => void reload()}
            />
          )}
          {provider === "openai" && (
            <AiKeyField
              key="openai"
              secretName="ai.openai"
              label="API key"
              source={settings.keySource}
              envVar="OPENAI_API_KEY"
              optional={settings.keyOptional}
              placeholder="sk-…"
              onChanged={() => void reload()}
            />
          )}
          {provider === "gateway" && (
            <AiKeyField
              key="gateway"
              secretName="ai.gateway"
              label="Token de sesión del gateway"
              source={settings.keySource}
              placeholder="Token emitido por el gateway"
              onChanged={() => void reload()}
            />
          )}

          {/* Modelo que no está en el catálogo del proveedor. */}
          {!stale && models.length > 0 && !modelAvailable && activeModel && (
            <div className="rounded-xl border border-gdb-warn/30 bg-gdb-warn/10 p-3.5 text-xs text-gdb-warnfg">
              <div className="flex items-start gap-2.5">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                <p>
                  El modelo{" "}
                  <code className="rounded bg-gdb-warn/15 px-1 py-0.5 font-mono text-[11px]">{activeModel}</code> no está
                  en el catálogo de {AI_PROVIDER_LABELS[provider]}.
                </p>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                <Button size="xs" variant="outline" onClick={() => document.getElementById("ai-model-search")?.focus()}>
                  <SearchIcon className="mr-1 size-3" />
                  Buscar otro
                </Button>
                {favorites.includes(activeModel) && (
                  <Button size="xs" variant="outline" onClick={() => removeFavoriteAndFallback(activeModel)}>
                    <Trash2Icon className="mr-1 size-3" />
                    Eliminar de favoritos
                  </Button>
                )}
                {provider === "openrouter" && (
                  <Button size="xs" variant="secondary" onClick={() => setModel(DEEPSEEK_DEFAULT)}>
                    Usar default DeepSeek
                  </Button>
                )}
              </div>
            </div>
          )}

          {stale && models.length === 0 && (
            <div className="rounded-xl border border-gdb-warn/30 bg-gdb-warn/10 p-3 text-xs text-gdb-warnfg">
              No se pudo obtener el catálogo de modelos de {AI_PROVIDER_LABELS[provider]}
              {provider === "openrouter" ? "." : " (revisa la URL y la key)."} Puedes escribir el nombre del modelo a mano.
            </div>
          )}

          {/* Modelo: catálogo + (para proveedores con URL) nombre a mano, porque un servidor local puede no listar. */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Modelo</Label>
              {currentModel && (
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  ctx {formatContext(currentModel.context_length)} · in {formatPrice(currentModel.pricing?.prompt)} / out{" "}
                  {formatPrice(currentModel.pricing?.completion)}
                </span>
              )}
            </div>
            {provider !== "openrouter" && (
              <Input
                key={`${provider}:model:${activeModel}`}
                data-testid="ai-model-manual"
                defaultValue={activeModel}
                placeholder="Nombre del modelo, p. ej. gpt-4o-mini"
                spellCheck={false}
                className="h-8 font-mono text-xs"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== activeModel && setModel(e.target.value.trim())}
              />
            )}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="ai-model-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelos…"
                className="h-9 rounded-xl pl-8 text-xs"
              />
            </div>
            <ScrollArea className="h-72 rounded-xl border border-border/60">
              {loading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Cargando modelos…</div>
              ) : (
                <div className="grid gap-0.5 p-1.5" data-testid="ai-model-list">
                  {favoriteModels.length > 0 && (
                    <div className="grid gap-0.5">
                      <div className="px-2 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Favoritos
                      </div>
                      {favoriteModels.map((m) => (
                        <ModelRow key={`fav-${m.id}`} model={m} />
                      ))}
                    </div>
                  )}
                  {otherModels.length > 0 && (
                    <div className="grid gap-0.5">
                      <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Todos
                      </div>
                      {otherModels.map((m) => (
                        <ModelRow key={`all-${m.id}`} model={m} />
                      ))}
                    </div>
                  )}
                  {filteredModels.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">No se encontraron modelos.</div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Budget & temperature */}
          <div className="grid grid-cols-3 gap-4 pt-1">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="schemaBudget" className="text-muted-foreground">Presupuesto de esquema</Label>
                <span className="font-mono text-[10.5px]">{settings.schemaBudgetChars.toLocaleString()} chars</span>
              </div>
              <input
                id="schemaBudget"
                type="range"
                min={4000}
                max={48000}
                step={2000}
                value={settings.schemaBudgetChars}
                onChange={(e) => updateSettings({ schemaBudgetChars: Number(e.target.value) })}
                className="h-1.5 w-full accent-primary"
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="temperature" className="text-muted-foreground">Temperatura</Label>
                <span className="font-mono text-[10.5px]">{settings.temperature.toFixed(1)}</span>
              </div>
              <input
                id="temperature"
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                className="h-1.5 w-full accent-primary"
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="maxTokens" className="text-muted-foreground">Largo de respuesta</Label>
                <span className="font-mono text-[10.5px]">{settings.maxTokens.toLocaleString()} tokens</span>
              </div>
              <input
                id="maxTokens"
                type="range"
                min={1024}
                max={16000}
                step={1024}
                value={settings.maxTokens}
                onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
                className="h-1.5 w-full accent-primary"
              />
            </div>
          </div>

          {!settings.enabled && (
            <p className="-mt-2 text-[11px] text-muted-foreground">
              Cuando la IA está deshabilitada se ocultan todos los botones y atajos.
            </p>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 border-t border-border/60 bg-muted/20 px-6 py-4 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            // Restaura parámetros y modelos, pero conserva el proveedor elegido (las keys viven aparte y no se tocan).
            onClick={() => updateSettings({ ...DEFAULT_AI_SETTINGS, provider }, true)}
          >
            <RotateCcwIcon className="mr-1 size-3.5" />
            Restaurar defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
