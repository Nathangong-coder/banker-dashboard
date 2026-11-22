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

/**
 * L-2 record home highlights panel: icon tile, eyebrow (object type), record name, actions, then 4–6 key fields as
 * label-over-value pairs (Salesforce compact layout). `children` = the Path under it, inside the same card.
 */
export function RecordHeader({
  icon,
  eyebrow,
  title,
  actions,
  fields,
  children,
}: {
  icon: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  fields?: { label: string; value: ReactNode }[];
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="px-4 pt-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brass-strong text-white" aria-hidden="true">
              {icon}
            </span>
            <div className="min-w-0">
              <div className="text-[12px] leading-tight text-muted">{eyebrow}</div>
              <h1 className="truncate text-[20px] leading-tight font-bold text-ink">{title}</h1>
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {fields && fields.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            {fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[12px] text-muted">{f.label}</dt>
                <dd className="text-[13px] text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {children && <div className="border-t border-line px-4 py-2.5">{children}</div>}
    </div>
  );
}

const PATH_MID = "[clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%,10px_50%)]";
const PATH_FIRST = "rounded-l-full [clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%)]";
const PATH_LAST = "rounded-r-full [clip-path:polygon(0_0,100%_0,100%_100%,0_100%,10px_50%)]";

/** P-1 Path (Salesforce): chevron steps; done = accent-soft, current = accent with white text, the rest neutral. */
export function Path<T extends string>({ steps, current, onPick, label = "Stage" }: { steps: { id: T; label: string }[]; current: T; onPick?: (id: T) => void; label?: string }) {
  const at = Math.max(0, steps.findIndex((s) => s.id === current));
  return (
    <ol aria-label={label} className="flex min-w-0 overflow-x-auto">
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
        const shape = cn(
          "flex h-8 w-full min-w-[96px] items-center justify-center px-5 text-[12px] whitespace-nowrap",
          i === 0 ? PATH_FIRST : i === steps.length - 1 ? PATH_LAST : PATH_MID,
          state === "done" && "bg-brass-soft text-brass-ink",
          state === "current" && "bg-brass-strong font-semibold text-white",
          state === "todo" && "bg-hover text-ink-2",
          onPick && state !== "current" && "cursor-pointer hover:brightness-95",
        );
        const inner = (
          <>
            {state === "done" && <Check className="mr-1 size-3.5 shrink-0" />}
            {s.label}
          </>
        );
        return (
          <li key={s.id} className={cn("flex min-w-0 flex-1", i > 0 && "-ml-1")}>
            {onPick ? (
              <button type="button" aria-current={state === "current" ? "step" : undefined} onClick={() => onPick(s.id)} className={shape} title={state === "current" ? "Current step" : `Set to ${s.label}`}>
                {inner}
              </button>
            ) : (
              <span aria-current={state === "current" ? "step" : undefined} className={shape}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** B-2 underline tabs for the sections of one page / record. */
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex max-w-full overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px flex h-10 items-center gap-1.5 border-b-[3px] px-3 text-[13px] whitespace-nowrap", value === t.id ? "border-brass-strong font-semibold text-ink" : "border-transparent text-ink-2 hover:border-line-2")}
        >
          {t.label}
          {t.count !== undefined && <span className="num text-[12px] font-normal text-muted">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

/** K-1 card: header (20 px icon, 14 px title, count, actions), body, optional footer link. Related lists use it. */
export function RelatedCard({ icon, title, count, actions, footer, children, className }: { icon?: ReactNode; title: ReactNode; count?: number; actions?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)]", className)}>
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        {icon && <span className="text-muted [&>svg]:size-[18px]">{icon}</span>}
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
          {title}
          {count !== undefined && <span className="num ml-1 font-normal text-muted">({count})</span>}
        </h2>
        {actions}
      </header>
      <div className="px-4 pb-3">{children}</div>
      {footer && <footer className="border-t border-line px-4 py-2 text-center text-[13px]">{footer}</footer>}
    </section>
  );
}

export type TimelineItem = { id: string; icon: ReactNode; tone?: "neutral" | "green" | "blue" | "amber" | "red"; title: ReactNode; meta?: ReactNode; body?: ReactNode };

/** P-2 activity timeline: icon column with a vertical line; each item = title, meta, optional body. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="py-2 text-[13px] text-muted">Nothing yet.</p>;
  return (
    <ol className="relative">
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-px bg-line" aria-hidden="true" />}
          <span
            className={cn(
              "z-[1] grid size-7 shrink-0 place-items-center rounded-full [&>svg]:size-3.5",
              it.tone === "green" ? "bg-green-soft text-green" : it.tone === "blue" ? "bg-blue-soft text-blue" : it.tone === "amber" ? "bg-amber-soft text-amber" : it.tone === "red" ? "bg-red-soft text-red" : "bg-hover text-muted",
            )}
            aria-hidden="true"
          >
            {it.icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[13px] text-ink">{it.title}</div>
            {it.meta && <div className="text-[12px] text-muted">{it.meta}</div>}
            {it.body && <div className="mt-1 text-[13px] whitespace-pre-line text-ink-2">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** L-3 queue group header: plain 14 px title + count. */
export function QueueGroup({ title, count, children, tone }: { title: ReactNode; count?: number; children: ReactNode; tone?: "red" }) {
  return (
    <section>
      <h3 className={cn("flex items-baseline gap-1.5 px-4 pt-3 pb-1.5 text-[14px] font-semibold", tone === "red" ? "text-red" : "text-ink")}>
        {title}
        {count !== undefined && <span className="num text-[12px] font-normal text-muted">({count})</span>}
      </h3>
      {children}
    </section>
  );
}
