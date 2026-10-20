"use client";

import { create } from "zustand";
import { Loader2, MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/util";
import { STATUS_LABEL, type Status } from "@/lib/types";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brass";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-strong whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        // primary = the filled accent (one per view); brass = the accent outline next to it; secondary = neutral.
        variant === "primary" && "bg-brass-strong text-white hover:bg-brass-hover",
        variant === "brass" && "border border-brass-strong bg-panel text-brass-ink hover:bg-brass-soft",
        variant === "secondary" && "border border-line-2 bg-panel text-ink hover:border-muted/60 hover:bg-subtle",
        variant === "ghost" && "text-ink-2 hover:bg-hover",
        variant === "danger" && "border border-red/30 bg-panel text-red hover:bg-red-soft",
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("rounded-xl border border-line bg-panel", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
      <div className="min-w-0 flex-1 basis-[220px]">
        <h3 className="text-[14.5px] font-medium text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
      </div>
      {/* On phones the actions wrap under the title instead of pushing the card wider than the screen. */}
      {right && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 md:shrink-0 [&>*]:max-w-full [&>*]:min-w-0">{right}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] leading-tight font-medium tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        "h-9 w-full rounded-lg border border-line-2 bg-panel px-2.5 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-brass-strong focus:outline-none focus:ring-2 focus:ring-brass/15",
        className,
      )}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cn(
        "w-full rounded-lg border border-line-2 bg-panel px-2.5 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-brass-strong focus:outline-none focus:ring-2 focus:ring-brass/15",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cn(
        "h-9 max-w-full min-w-0 rounded-lg border border-line-2 bg-panel px-2 text-[13px] text-ink focus:border-brass-strong focus:outline-none",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[11.5px] text-red">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>
      )}
    </label>
  );
}

type Tone = "neutral" | "green" | "red" | "blue" | "amber" | "brass" | "navy";
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-hover text-ink-2",
        tone === "green" && "bg-green-soft text-green",
        tone === "red" && "bg-red-soft text-red",
        tone === "blue" && "bg-blue-soft text-blue",
        tone === "amber" && "bg-amber-soft text-amber",
        tone === "brass" && "bg-brass-soft text-brass-ink",
        tone === "navy" && "bg-navy text-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<Status, Tone> = {
  new: "neutral",
  drafted: "brass",
  sent: "blue",
  followed_up: "amber",
  replied: "green",
  call_scheduled: "green",
  done: "navy",
  ignored: "neutral",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={status === "ignored" ? "line-through opacity-70" : ""}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={cn("num mt-1.5 text-[28px] leading-none font-medium tracking-tight", tone === "red" && "text-red", tone === "green" && "text-green")}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-brass transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-[12px] text-muted">
        {label ?? `${value}/${max}`}
      </span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn("w-full rounded-2xl border border-line bg-panel shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-3.5 cursor-pointer accent-brass-strong"
    />
  );
}

/** A pill switch between a few views ("All | Upcoming | Past"). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, ReactNode])[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex max-w-full overflow-x-auto rounded-lg bg-hover p-[3px]", className)}>
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          type="button"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-3 py-1 text-[12.5px] font-medium whitespace-nowrap transition-colors",
            value === v ? "bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export type MenuItem =
  | { label: ReactNode; hint?: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }
  | "divider";

/** The "⋯" overflow menu: secondary actions live here so a page shows one or two buttons. */
export function Menu({
  items,
  label = "More actions",
  trigger,
  align = "right",
  up,
}: {
  items: (MenuItem | false | null | undefined)[];
  label?: string;
  /** A custom trigger (its own onClick is replaced by the toggle). */
  trigger?: (toggle: () => void, open: boolean) => ReactNode;
  align?: "left" | "right";
  up?: boolean;
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
  const real = items.filter((it): it is MenuItem => !!it);
  // No leading, trailing or doubled dividers once conditional items drop out.
  const shown = real.filter((it, i) => it !== "divider" || (i > 0 && i < real.length - 1 && real[i - 1] !== "divider"));
  const toggle = () => setOpen((o) => !o);
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger ? (
        trigger(toggle, open)
      ) : (
        <Button variant="ghost" aria-label={label} title={label} aria-expanded={open} onClick={toggle} className="px-2">
          <MoreHorizontal className="size-4" />
        </Button>
      )}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-40 w-[290px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]",
            align === "right" ? "right-0" : "left-0",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {shown.map((it, i) =>
            it === "divider" ? (
              <div key={i} className="my-1.5 border-t border-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
                  it.danger ? "text-red" : "text-ink",
                )}
              >
                {it.icon && <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", it.danger ? "text-red" : "text-muted")}>{it.icon}</span>}
                <span className="min-w-0">
                  {it.label}
                  {it.hint && <span className="mt-0.5 block text-[12px] text-muted">{it.hint}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A small ring chart for a share (0–1), with the percentage in the middle. */
export function Donut({ value, size = 60, label }: { value: number; size?: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(var(--chart) ${pct * 360}deg, var(--chart-soft) 0)` }}
      role="img"
      aria-label={label ?? `${Math.round(pct * 100)}%`}
    >
      <div className="num grid place-items-center rounded-full bg-panel text-[12.5px] font-medium text-ink" style={{ width: size * 0.7, height: size * 0.7 }}>
        {Math.round(pct * 100)}%
      </div>
    </div>
  );
}

/** A KPI tile: label, big number, one line under it, optional ring on the left. */
export function Kpi({ label, value, sub, tone, ring }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad"; ring?: number }) {
  return (
    <Card className="flex min-w-0 items-center gap-4 px-5 py-4">
      {ring !== undefined && <Donut value={ring} />}
      <div className="min-w-0">
        <div className="text-[12.5px] text-muted">{label}</div>
        <div className="num mt-0.5 text-[28px] leading-tight font-medium tracking-tight text-ink">{value}</div>
        {sub && <div className={cn("mt-0.5 text-[12px]", tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-muted")}>{sub}</div>}
      </div>
    </Card>
  );
}

/* ---------------- toasts ---------------- */
type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
export const useToasts = create<{ list: Toast[]; push: (kind: Toast["kind"], text: string) => void; drop: (id: number) => void }>(
  (set, get) => ({
    list: [],
    push: (kind, text) => {
      const id = Date.now() + Math.random();
      set({ list: [...get().list, { id, kind, text }] });
      setTimeout(() => get().drop(id), kind === "err" ? 8000 : 4500);
    },
    drop: (id) => set({ list: get().list.filter((t) => t.id !== id) }),
  }),
);
export const toast = {
  ok: (t: string) => useToasts.getState().push("ok", t),
  err: (t: string) => useToasts.getState().push("err", t),
  info: (t: string) => useToasts.getState().push("info", t),
};

export function Toaster() {
  const { list, drop } = useToasts();
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-lg",
            t.kind === "ok" && "border-green/20 bg-green-soft text-green",
            t.kind === "err" && "border-red/20 bg-red-soft text-red",
            t.kind === "info" && "border-line bg-panel text-ink",
          )}
        >
          <span className="flex-1">{t.text}</span>
          <button onClick={() => drop(t.id)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
