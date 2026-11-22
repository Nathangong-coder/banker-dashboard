"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Pin } from "lucide-react";
import { cn } from "@/lib/util";

/**
 * CRM-style building blocks (docs/DESIGN.md). ObjectHeader = L-1's page header: icon tile, eyebrow, the view name
 * (with its switcher), actions on the right, then the meta line (count · sort · filters) and list controls.
 */
export function ObjectHeader({
  icon,
  eyebrow,
  title,
  actions,
  meta,
  controls,
}: {
  icon: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 pt-3 pb-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brass-strong text-white" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="text-[12px] leading-tight text-muted">{eyebrow}</div>
            <div className="text-[18px] leading-tight font-bold text-ink">{title}</div>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {(meta || controls) && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-[12px] text-muted">{meta}</div>
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
        </div>
      )}
    </div>
  );
}

/** Joined icon buttons (B-1): "Display as" table / grid / board. */
export function IconToggleGroup<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; icon: ReactNode; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded border border-line-2 bg-panel">
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("grid h-8 w-8 place-items-center text-muted hover:bg-hover", i > 0 && "border-l border-line-2", value === o.id && "bg-brass-soft text-brass-ink")}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/** A neutral (B-1) button or link-styled control used in headers. */
export function NeutralButton({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded border border-line-2 bg-panel px-3 text-[13px] font-medium text-brass-ink hover:bg-hover disabled:opacity-50", className)}
    >
      {children}
    </button>
  );
}

/** The view name with a ▾ menu of saved views (L-4). */
export function ViewSwitcher<V extends { id: string; name: string; pinned?: boolean }>({
  views,
  current,
  onPick,
  footer,
}: {
  views: V[];
  current: V;
  onPick: (v: V) => void;
  footer?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded px-1 -ml-1 hover:bg-hover">
        {current.name}
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-1 w-[260px] rounded-lg border border-line bg-panel py-1 text-[13px] font-normal shadow-[0_0_7px_rgba(0,0,0,0.14),0_5px_5px_rgba(0,0,0,0.14)]">
          <div className="px-3 py-1.5 text-[12px] text-muted">Views</div>
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(v);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
            >
              <Check className={cn("size-3.5", v.id === current.id ? "text-brass-strong" : "invisible")} />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {v.pinned && <Pin className="size-3.5 text-muted" aria-label="Opens by default" />}
            </button>
          ))}
          {footer && <div className="mt-1 border-t border-line pt-1">{footer(() => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}

export function MenuRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hover">
      {children}
    </button>
  );
}
