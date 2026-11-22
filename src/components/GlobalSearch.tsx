"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, FileText, Search, UserRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { cn } from "@/lib/util";
import { ALL_PAGES } from "./AppNav";

type Hit = { kind: "person" | "bank" | "page"; id: string; title: string; sub?: string; href: string };

const ICON = { person: UserRound, bank: Building2, page: FileText };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Global search (docs/DESIGN.md G-1): people, banks and pages from one box in the header. "/" focuses it. People open
 * their record page, banks the bank's page.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const contacts = useStore((s) => s.contacts);
  const added = useStore((s) => s.coverage.added);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, []);

  const banks = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) if (c.bank?.trim() && !m.has(canonBank(c.bank))) m.set(canonBank(c.bank), c.bank.trim());
    for (const a of added) if (!m.has(canonBank(a.name))) m.set(canonBank(a.name), a.name);
    return [...m].map(([key, name]) => ({ key, name }));
  }, [contacts, added]);

  const hits = useMemo<Hit[]>(() => {
    const t = norm(q.trim());
    if (!t) return [];
    const words = t.split(/\s+/);
    const has = (s: string) => words.every((w) => norm(s).includes(w));
    const people = contacts
      .filter((c) => has(`${c.name} ${c.bank} ${c.email} ${c.position}`))
      .sort((a, b) => Number(!norm(a.name).startsWith(words[0])) - Number(!norm(b.name).startsWith(words[0])))
      .slice(0, 6)
      .map<Hit>((c) => ({ kind: "person", id: c.id, title: c.name, sub: [c.position, c.bank].filter(Boolean).join(" · "), href: `/person?id=${encodeURIComponent(c.id)}` }));
    const bankHits = banks
      .filter((b) => has(b.name))
      .slice(0, 4)
      .map<Hit>((b) => ({ kind: "bank", id: b.key, title: b.name, sub: `${contacts.filter((c) => canonBank(c.bank) === b.key).length} people`, href: `/bank?key=${encodeURIComponent(b.key)}` }));
    const pages = ALL_PAGES.filter((p) => has(p.label))
      .slice(0, 4)
      .map<Hit>((p) => ({ kind: "page", id: p.href, title: p.label, href: p.href }));
    return [...bankHits, ...people, ...pages];
  }, [q, contacts, banks]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
    router.push(h.href);
  };

  return (
    <div ref={box} className={cn("relative", className)}>
      <label className="flex h-8 items-center gap-2 rounded border border-white/20 bg-white/10 px-2.5 text-top-muted focus-within:border-white/60 focus-within:bg-panel focus-within:text-muted">
        <Search className="size-4 shrink-0" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && hits[sel]) go(hits[sel]);
            else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="global-search-list"
          aria-label="Search people, banks and pages"
          placeholder="Search people, banks, pages…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-top-ink outline-none placeholder:text-top-muted focus:text-ink focus:placeholder:text-muted"
        />
        <kbd className="hidden rounded border border-current/30 px-1 text-[11px] leading-4 opacity-70 lg:inline">/</kbd>
      </label>
      {open && q.trim() && (
        <div id="global-search-list" role="listbox" className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-line bg-panel py-1 text-ink shadow-[0_0_7px_rgba(0,0,0,0.14),0_5px_5px_rgba(0,0,0,0.14)]">
          {hits.length ? (
            hits.map((h, i) => {
              const I = ICON[h.kind];
              return (
                <button
                  key={`${h.kind}:${h.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(h)}
                  className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left", i === sel && "bg-hover")}
                >
                  <I className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{h.title}</span>
                    {h.sub && <span className="block truncate text-[12px] text-muted">{h.sub}</span>}
                  </span>
                  <span className="text-[11px] text-muted capitalize">{h.kind}</span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-[13px] text-muted">Nothing matches “{q.trim()}”.</div>
          )}
        </div>
      )}
    </div>
  );
}
