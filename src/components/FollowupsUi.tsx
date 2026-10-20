"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/util";

/** Small building blocks shared by the Follow-ups page's table rows (one look for every list on the page). */

/**
 * The table inside a list card. From lg up it's a real table; below that each row wraps into a stacked block (name on
 * top, details and actions under it), so phones never scroll sideways and row menus aren't clipped by a scroll box.
 */
export function ListTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <table className={cn("w-full text-[13px] max-lg:block", className)}>
      <thead className="bg-subtle text-left text-[11px] tracking-wide text-muted uppercase max-lg:hidden">
        <tr className="border-b border-line">
          {head.map((h, i) => (
            <th key={i} className={cn("px-3 py-2 font-medium first:pl-4 last:pr-4", i === head.length - 1 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line max-lg:block">{children}</tbody>
    </table>
  );
}

/** One table row: highlighted when selected; its actions show on hover (always on touch-size screens). */
export function Row({ selected, tone, children }: { selected?: boolean; tone?: "amber"; children: ReactNode }) {
  return (
    <tr
      className={cn(
        "group align-middle hover:bg-subtle lg:h-11",
        "max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-2 max-lg:gap-y-1.5 max-lg:px-4 max-lg:py-2.5",
        selected && "bg-brass-soft/50 hover:bg-brass-soft/60",
        tone === "amber" && !selected && "bg-amber-soft/40",
      )}
    >
      {children}
    </tr>
  );
}

/** A cell. `main` = the name cell, which takes the first line on its own on small screens. */
export function Cell({ children, className, main, shrink }: { children?: ReactNode; className?: string; main?: boolean; shrink?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2 first:pl-4 last:pr-4 max-lg:block max-lg:p-0 max-lg:first:pl-0 max-lg:last:pr-0",
        main && "max-lg:min-w-0 max-lg:flex-1 max-lg:basis-[70%]",
        shrink && "w-px",
        "max-lg:last:ml-auto",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Name + a muted second line; clicking opens the contact. */
export function NameCell({ name, sub, onOpen, extra }: { name: ReactNode; sub?: ReactNode; onOpen: () => void; extra?: ReactNode }) {
  return (
    <button onClick={onOpen} className="block max-w-full min-w-0 text-left lg:max-w-[340px]">
      <div className="truncate font-medium text-ink hover:underline">
        {name}
        {extra}
      </div>
      {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
    </button>
  );
}

/** Row actions: hidden until the row is hovered or focused (or selected); always visible below lg (no hover on phones). */
export function RowActions({ children, show }: { children: ReactNode; show?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100",
        show && "lg:opacity-100",
      )}
    >
      {children}
    </div>
  );
}

export function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" className="size-3.5 cursor-pointer accent-brass-strong align-middle" aria-label={label} checked={checked} onChange={onChange} />;
}

/** A one-line notice above a list (dates missing, too-early sends, a reply that looks like a no…). */
export function Notice({ tone = "neutral", icon, children, action }: { tone?: "neutral" | "amber" | "red"; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-[12.5px]",
        tone === "neutral" && "border-line bg-panel text-ink-2",
        tone === "amber" && "border-amber/30 bg-amber-soft text-ink",
        tone === "red" && "border-red/30 bg-red-soft text-ink",
      )}
    >
      {icon && <span className={cn("shrink-0 [&>svg]:size-4", tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : "text-muted")}>{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {action && <span className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</span>}
    </div>
  );
}
