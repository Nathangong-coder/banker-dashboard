"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/util";

/**
 * The color themes (globals.css `[data-theme]` blocks). Per browser: localStorage "coverage:theme", applied to
 * <html data-theme> here and before first paint by layout.tsx's script. Recruitly (the logo's colors) is the default since 2026-10-23; slate was before.
 */
export const THEMES = [
  { id: "recruitly", name: "Recruitly", note: "Navy, cream and green (the logo)", top: "#0e1a2b", side: "#0e1a2b", paper: "#f4f3ef", accent: "#1f7a5c" },
  { id: "slate", name: "Slate", note: "Slate bars, orange accent", top: "#2d3e50", side: "#33475b", paper: "#f5f8fa", accent: "#ff7a59" },
  { id: "cream", name: "Cream", note: "Warm cream, black bar, orange", top: "#1f1f1f", side: "#fffdf8", paper: "#f8f5ee", accent: "#ff4800" },
  { id: "navy", name: "Navy", note: "Navy and brass (the original)", top: "#0f1d33", side: "#13233f", paper: "#f5f4ef", accent: "#b3862f" },
  { id: "graphite", name: "White", note: "Minimal white, teal accent", top: "#ffffff", side: "#ffffff", paper: "#f7f7f8", accent: "#0f766e" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
const KEY = "coverage:theme";

function current(): ThemeId {
  const t = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  return THEMES.some((x) => x.id === t) ? (t as ThemeId) : "recruitly";
}

export function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private window: the theme still applies until reload */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES.find((t) => t.id === id)!.top);
}

export function ThemePicker() {
  // Settings renders only in the browser (after the store loads), so the DOM can be read on first render.
  const [theme, set] = useState<ThemeId>(current);
  return (
    <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-5">
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setTheme(t.id);
              set(t.id);
            }}
            className={cn("overflow-hidden rounded-xl border text-left transition-colors", on ? "border-brass-strong ring-2 ring-brass/25" : "border-line hover:border-line-2")}
          >
            {/* A tiny picture of the app in that theme: top bar, sidebar, page, an accent button. */}
            <div className="flex h-24 flex-col" style={{ background: t.paper }}>
              <div className="h-4 shrink-0" style={{ background: t.top, borderBottom: t.top === "#ffffff" ? "1px solid #ececef" : undefined }} />
              <div className="flex flex-1">
                <div className="w-1/4" style={{ background: t.side, borderRight: t.side.startsWith("#ff") ? "1px solid #ebe6dc" : undefined }} />
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="h-2 w-1/2 rounded-sm bg-black/15" />
                  <div className="h-6 rounded-md border border-black/5 bg-white" />
                  <div className="h-3 w-10 self-end rounded-sm" style={{ background: t.accent }} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">{t.name}</div>
                <div className="truncate text-[11.5px] text-muted">{t.note}</div>
              </div>
              {on && <Check className="size-4 shrink-0 text-brass-strong" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
