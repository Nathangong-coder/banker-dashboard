"use client";

import { create } from "zustand";
import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
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
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        variant === "primary" && "bg-navy text-white hover:bg-[#1c3259]",
        variant === "brass" && "bg-brass text-white hover:bg-[#9c7427]",
        variant === "secondary" && "border border-line-2 bg-panel text-ink hover:bg-[#f0eee7]",
        variant === "ghost" && "text-ink-2 hover:bg-[#ebe9e1]",
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
    <div {...rest} className={cn("rounded-lg border border-line bg-panel", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div>
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-[34px] leading-none tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-[13.5px] text-ink-2">{sub}</p>}
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
        "h-9 w-full rounded-md border border-line-2 bg-panel px-2.5 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10",
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
        "w-full rounded-md border border-line-2 bg-panel px-2.5 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10",
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
        "h-9 rounded-md border border-line-2 bg-panel px-2 text-[13px] text-ink focus:border-navy focus:outline-none",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "green" | "red" | "blue" | "amber" | "brass" | "navy";
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-[#ecebe4] text-ink-2",
        tone === "green" && "bg-green-soft text-green",
        tone === "red" && "bg-red-soft text-red",
        tone === "blue" && "bg-blue-soft text-blue",
        tone === "amber" && "bg-amber-soft text-amber",
        tone === "brass" && "bg-brass-soft text-[#7d5d1f]",
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
    <div className="px-4 py-3.5">
      <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={cn("num mt-1 text-[26px] leading-none", tone === "red" && "text-red", tone === "green" && "text-green")}>
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
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e7e4da]">
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
        className={cn("w-full rounded-xl border border-line bg-panel shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-[#efede5]" aria-label="Close">
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
      className="size-3.5 cursor-pointer accent-navy"
    />
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
            "flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-lg",
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
