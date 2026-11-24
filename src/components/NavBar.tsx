"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, CalendarPlus, Check, ChevronDown, ChevronRight, Loader2, MessageSquareText, NotebookPen, Plus, RefreshCw, Search, UserPlus } from "lucide-react";
import Link from "./Link";
import { cn } from "@/lib/util";
import { useStore } from "@/lib/store";
import { SYNC_EVERY, lastRun, runBackgroundJobs, useBackground } from "@/lib/backgroundJobs";
import { NAV, categoryOf, isActive, type NavCategory } from "./navData";
import { Input, Menu, Modal, toast } from "./ui";
import { AddContactModal } from "./AddContact";
import { CallInvite } from "./Scheduling";

/**
 * The second header row (owner, 2026-11-23: "I liked the two layers… change it to something cool"): the categories
 * with icons and an underline that grows in; hovering one opens its pages with a line each (a HubSpot-style menu);
 * on the right, where you are and a "+ New" menu for the things you start most.
 */
const Count = ({ n }: { n: number }) => (n > 0 ? <span className="num rounded bg-brass-strong px-1.5 text-[11px] leading-[18px] font-semibold text-white">{n}</span> : null);

export function CategoryBar({ path, badge }: { path: string; badge: (href: string) => number }) {
  const current = categoryOf(path);
  const page = current?.pages.find((p) => isActive(p.href, path));
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = (label: string | null) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (label) setOpen(label);
    else closeTimer.current = setTimeout(() => setOpen(null), 140);
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  // A click anywhere navigates or closes; the menu never outlives the page it was opened on.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setOpen(null);
  }

  return (
    <div className="sticky top-12 z-20 hidden h-11 shrink-0 items-stretch border-b border-top-line bg-top px-3 text-top-ink md:flex">
      <nav aria-label="Categories" className="flex items-stretch">
        {NAV.map((c) => (
          <CategoryTab key={c.label} c={c} on={c === current} open={open === c.label} path={path} badge={badge} onHover={(v) => hold(v ? c.label : null)} onToggle={() => setOpen(open === c.label ? null : c.label)} />
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {current && page && current.pages.length > 1 && (
          <div className="hidden items-center gap-1 text-[12px] text-top-muted lg:flex" aria-label="You are here">
            {current.label}
            <ChevronRight className="size-3.5" />
            <span className="font-semibold text-top-ink">{page.label}</span>
          </div>
        )}
        <NewMenu />
      </div>
    </div>
  );
}

function CategoryTab({ c, on, open, path, badge, onHover, onToggle }: { c: NavCategory; on: boolean; open: boolean; path: string; badge: (href: string) => number; onHover: (v: boolean) => void; onToggle: () => void }) {
  const n = c.pages.reduce((s, p) => s + badge(p.href), 0);
  const many = c.pages.length > 1;
  return (
    <div className="relative flex" onMouseEnter={() => many && onHover(true)} onMouseLeave={() => many && onHover(false)}>
      <Link
        href={c.pages[0].href}
        aria-current={on ? "true" : undefined}
        className={cn(
          "group relative flex items-center gap-2 px-3 text-[13px] whitespace-nowrap transition-colors",
          "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:origin-center after:scale-x-0 after:rounded-t after:bg-brass-strong after:transition-transform after:duration-200",
          on ? "font-semibold text-top-ink after:scale-x-100" : "text-top-muted hover:text-top-ink hover:after:scale-x-40",
        )}
      >
        <c.icon className={cn("size-4 transition-colors", on ? "text-brass-strong" : "opacity-70 group-hover:opacity-100")} />
        {c.label}
        <Count n={n} />
      </Link>
      {many && (
        <button type="button" aria-label={`${c.label} pages`} aria-expanded={open} onClick={onToggle} className="-ml-2 grid w-6 place-items-center text-top-muted hover:text-top-ink">
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
      {open && (
        <div role="menu" className="absolute top-full left-0 z-50 w-[340px] rounded-b-lg border border-t-0 border-line bg-panel p-1.5 text-ink shadow-[0_8px_16px_rgba(0,0,0,0.14)]">
          {c.pages.map((p) => {
            const here = isActive(p.href, path);
            return (
              <Link key={p.href} role="menuitem" href={p.href} className={cn("flex items-start gap-3 rounded-md px-2.5 py-2 hover:bg-hover", here && "bg-brass-soft")}>
                <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md", here ? "bg-brass-strong text-white" : "bg-hover text-muted")}>
                  <p.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    {p.label}
                    <Count n={badge(p.href)} />
                  </span>
                  {p.hint && <span className="block text-[12px] text-muted">{p.hint}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "+ New": the things you start most, from anywhere (Salesforce's global actions). */
function NewMenu() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <Menu
        label="New"
        trigger={(toggle, open) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" className="inline-flex h-7 items-center gap-1 rounded bg-brass-strong px-2.5 text-[12px] font-semibold text-white hover:bg-brass-hover">
            <Plus className="size-3.5" /> New
          </button>
        )}
        items={[
          { label: "Person", hint: "Add a banker to your tracker", icon: <UserPlus />, onClick: () => setAdding(true) },
          { label: "Calendar invite", hint: "Put a chat on your calendar and invite them", icon: <CalendarPlus />, onClick: () => setInviting(true) },
          { label: "Chat log", hint: "Notes from a call or coffee chat", icon: <NotebookPen />, onClick: () => router.push("/log?new=1") },
          { label: "Reminder", hint: "\"Reach out in January\"", icon: <BellPlus />, onClick: () => router.push("/think?tab=reminders") },
          "divider",
          { label: "Find people", hint: "Search for bankers at a firm", icon: <Search />, onClick: () => router.push("/find") },
        ]}
      />
      <AddContactModal open={adding} onClose={() => setAdding(false)} />
      <InvitePicker open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}

/** Pick who, then the same invite form as a person's page. */
function InvitePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const contacts = useStore((s) => s.contacts);
  const [q, setQ] = useState("");
  const [id, setId] = useState<string | null>(null);
  const c = contacts.find((x) => x.id === id);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    const engaged = (x: (typeof contacts)[number]) => Number(!!(x.repliedAt || x.call || x.chats?.length));
    return contacts
      .filter((x) => x.email && (!t || `${x.name} ${x.bank}`.toLowerCase().includes(t)))
      .sort((a, b) => engaged(b) - engaged(a) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [contacts, q]);
  const close = () => {
    setId(null);
    setQ("");
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={c ? `Invite ${c.name} to a call` : "Calendar invite: who with?"} wide={!!c}>
      {c ? (
        <CallInvite c={c} onClose={close} />
      ) : (
        <div className="grid gap-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or bank" aria-label="Who" />
          <ul className="divide-y divide-line rounded border border-line">
            {hits.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setId(x.id)} className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover">
                  <span className="font-semibold text-ink">{x.name}</span>
                  <span className="truncate text-[12px] text-muted">{x.bank}</span>
                </button>
              </li>
            ))}
            {!hits.length && <li className="px-3 py-2 text-[13px] text-muted">Nobody with an email matches.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

const ago = (t: number, now: number) => {
  if (!t) return "never";
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** Sync now (everything in lib/backgroundJobs.ts) + the schedule, in the top row. */
export function SyncButton() {
  const { running, step, at } = useBackground();
  const every = useStore((s) => s.settings.syncEvery ?? "6h");
  const setSettings = useStore((s) => s.setSettings);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);
  const last = Math.max(at, lastRun());
  const run = async () => {
    await runBackgroundJobs({ manual: true });
    setNow(Date.now());
    toast.ok("Synced: Gmail, calendar, conversations and your account.");
  };
  return (
    <div className="hidden items-center overflow-hidden rounded border border-line-2 sm:flex" title={running ? step : `Last sync ${ago(last, now)} · ${SYNC_EVERY.find((s) => s.id === every)?.label}`}>
      <button type="button" onClick={() => void run()} disabled={running} className="flex h-8 items-center gap-1.5 px-2.5 text-[12px] text-top-muted hover:bg-hover hover:text-top-ink disabled:opacity-80">
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        <span className="hidden xl:inline">{running ? "Syncing…" : `Synced ${ago(last, now)}`}</span>
        <span className="xl:hidden">Sync</span>
      </button>
      <Menu
        label="Sync schedule"
        trigger={(toggle, open) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label="Sync schedule" className="grid h-8 w-6 place-items-center border-l border-line-2 text-top-muted hover:bg-hover hover:text-top-ink">
            <ChevronDown className="size-3.5" />
          </button>
        )}
        items={[
          ...SYNC_EVERY.map((s) => ({
            label: s.label,
            hint: s.id === "manual" ? "Nothing runs in the background; press Sync" : undefined,
            icon: s.id === every ? <Check /> : <span className="block size-4" />,
            onClick: () => setSettings((x) => ({ ...x, syncEvery: s.id })),
          })),
          "divider" as const,
          {
            label: "Update tonight's text",
            hint: "Send the server tonight's 9 PM list now (Sync does this too, last)",
            icon: <MessageSquareText />,
            onClick: () =>
              void import("@/lib/serverSync")
                .then((m) => m.syncServer())
                .then((st) => (st ? toast.ok("Tonight's 9 PM list is up to date on the server.") : toast.info("Automatic sending is off, so there's no 9 PM text to update.")))
                .catch((e: Error) => toast.err(e.message)),
          },
        ]}
      />
    </div>
  );
}
