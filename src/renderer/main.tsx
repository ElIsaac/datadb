/**
 * Punto de entrada del renderer de Electron. Es el unico arranque de la UI desde la fase 4:
 * `npm run dev:web` ya no existe (Next.js se borro por completo) y el arranque de Next
 * (src/app/layout.tsx + page.tsx) ya no existe tampoco.
 *
 * Monta el mismo arbol que montaba aquel layout+page juntos:
 *   AppProvider > TooltipProvider > AppShell, mas el Toaster.
 * Lo unico que NO se replica aqui es `next/font` (las tipografias salen de ./fonts.css, fase 1,
 * F1.3) ni el `metadata`/titulo de Next (el titulo lo pone index.html; el shell <html>/<body>,
 * con sus clases `h-full antialiased dark` y `min-h-full flex flex-col`, tambien vive en
 * index.html).
 *
 * Orden de imports CSS: fonts.css ANTES que globals.css porque globals.css consume las
 * variables --font-inter y --font-jetbrains-mono que declara fonts.css.
 *
 * Deliberadamente sin router: la app es una sola pantalla con paneles.
 */
import "./fonts.css";
import "./globals.css";
// Spike F2: el chrome del editor (scrollbar, cursor, selección, foco y resaltado de coincidencias).
// Va DESPUÉS de globals.css para poder pisar lo que el tema puso encima de las clases `.cm-*`.
import "./editor-chrome.css";
// Aplica el tema guardado (variables --gdb-* y clase .dark) antes del primer render (fase 7, T4).
import "@/theme/theme-store";
// Fase 15 (T5, R13): el ENRUTADOR DE TECLADO POR FOCO. Se instala aquí —y no en un `useEffect` de
// un componente— porque es un listener único de `window` que tiene que existir desde el arranque
// del renderer, haya o no componente montado (el orden de montaje de React no es un contrato que
// este listener deba tener). Es idempotente; una recarga de página (HMR) lo reinstala una sola vez.
import { instalarEnrutadorDeTeclado } from "@/shell/keyboard-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "@/hooks/use-app-state";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

instalarEnrutadorDeTeclado();

const el = document.getElementById("root");
if (!el) throw new Error("No se encontro #root en index.html");

createRoot(el).render(
  <StrictMode>
    <AppProvider>
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>
    </AppProvider>
    <Toaster position="bottom-right" />
  </StrictMode>
);
