"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LogOut, Menu as MenuIcon, Moon, Sun, UserRound, X } from "lucide-react";
import { cn } from "@/lib/util";
import { NAV, PROFILE_PAGES, categoryOf, isActive, type NavPage } from "./navData";

export { ALL_PAGES, IceCube, NAV, PROFILE_PAGES, categoryOf, isActive, type NavCategory, type NavPage } from "./navData";
import { useSession } from "@/lib/session";
import { isDark, toggleDark } from "./ThemePicker";
import { SignInButton, signOut } from "./Account";

const Count = ({ n }: { n: number }) => (n > 0 ? <span className="num rounded bg-brass-strong px-1.5 text-[11px] leading-[18px] font-semibold text-white">{n}</span> : null);

/** The categories, inside the header (≥ 768 px). */
export function CategoryTabs({ path, badge }: { path: string; badge: (href: string) => number }) {
  const current = categoryOf(path);
  return (
    <nav aria-label="Categories" className="hidden h-full items-stretch md:flex">
      {NAV.map((c) => {
        const on = c === current;
        const n = c.pages.reduce((s, p) => s + badge(p.href), 0);
        return (
          <Link
            key={c.label}
            href={c.pages[0].href}
            aria-current={on ? "true" : undefined}
            className={cn("relative flex items-center gap-1.5 px-3 text-[13px] whitespace-nowrap", on ? "font-semibold text-top-ink" : "text-top-muted hover:text-top-ink")}
          >
            {c.label}
            <Count n={n} />
            {on && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-brass-strong" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** The current category's pages, down the left (only when it has more than one). */
export function SideNav({ path, badge }: { path: string; badge: (href: string) => number }) {
  const c = categoryOf(path);
  if (!c || c.pages.length < 2) return null;
  return (
    <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-[208px] shrink-0 overflow-y-auto border-r border-top-line bg-side px-2 py-3 text-side-ink md:block">
      <div className="px-2.5 pb-2 text-[12px] text-side-muted">{c.label}</div>
      <nav aria-label={c.label} className="grid gap-0.5">
        {c.pages.map((p) => {
          const on = isActive(p.href, path);
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={on ? "page" : undefined}
              className={cn("relative flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px]", on ? "bg-side-active font-semibold" : "hover:bg-side-hover")}
            >
              {on && <span className="absolute top-1.5 bottom-1.5 -left-2 w-[3px] rounded-r bg-side-mark" />}
              <p.icon className="size-4 shrink-0 opacity-80" />
              <span className="flex-1">{p.label}</span>
              <Count n={badge(p.href)} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

const subscribeTheme = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => o.disconnect();
};
export const useDarkMode = () => useSyncExternalStore(subscribeTheme, isDark, () => false);

/** Sun / moon: all-light ↔ all-dark. */
export function ThemeToggle() {
  const dark = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggleDark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid size-9 place-items-center rounded text-top-muted hover:bg-hover hover:text-top-ink"
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return ref;
}

/** The profile menu: you, Settings / Corrections / Applications, light or dark, sign in / out. */
export function ProfileMenu({ path }: { path: string }) {
  const user = useSession((s) => s.user);
  const mode = useSession((s) => s.mode);
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const dark = useDarkMode();
  const signedOut = mode === "demo" || mode === "legacy" || mode === "blocked" || !user;
  const onProfilePage = PROFILE_PAGES.some((p) => isActive(p.href, path));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile and settings"
        aria-expanded={open}
        title={user?.email ?? "Profile and settings"}
        className={cn("grid size-9 place-items-center overflow-hidden rounded-full hover:bg-hover", onProfilePage && "ring-2 ring-brass-strong")}
      >
        {user?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
        ) : (
          <UserRound className="size-[18px] text-top-muted" />
        )}
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-64 rounded-lg border border-line bg-panel py-1 text-ink shadow-[0_0_7px_rgba(0,0,0,0.14),0_5px_5px_rgba(0,0,0,0.14)]">
          <div className="border-b border-line px-3 py-2 text-[13px]">
            {user && !signedOut ? (
              <>
                <div className="font-semibold">{user.name ?? user.email}</div>
                <div className="truncate text-[12px] text-muted">{user.email}</div>
              </>
            ) : (
              <SignInButton label="Sign in with Google" className="h-8 w-full text-[13px]" />
            )}
          </div>
          {PROFILE_PAGES.map((p) => (
            <Link key={p.href} role="menuitem" href={p.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-hover", isActive(p.href, path) && "font-semibold")}>
              <p.icon className="size-4 text-muted" />
              {p.label}
            </Link>
          ))}
          <button type="button" role="menuitem" onClick={toggleDark} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-hover">
            {dark ? <Sun className="size-4 text-muted" /> : <Moon className="size-4 text-muted" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          {user && !signedOut && (
            <button type="button" role="menuitem" onClick={() => void signOut()} className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2 text-left text-[13px] hover:bg-hover">
              <LogOut className="size-4 text-muted" /> Sign out
            </button>
          )}
          <div className="flex gap-3 border-t border-line px-3 pt-2 pb-1 text-[12px] text-muted">
            <Link href="/privacy" onClick={() => setOpen(false)} className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" onClick={() => setOpen(false)} className="hover:text-ink">
              Terms
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Phones: a menu button in the header opens every page as a list (DESIGN.md §8). */
export function MobileMenu({ path, badge, footer }: { path: string; badge: (href: string) => number; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const groups: { label: string; pages: NavPage[] }[] = [...NAV, { label: "You", pages: PROFILE_PAGES }];
  return (
    <>
      <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-11 shrink-0 place-items-center text-top-ink md:hidden">
        <MenuIcon className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col overflow-y-auto bg-panel text-ink shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <span className="text-[14px] font-semibold">Coverage</span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="grid size-11 place-items-center text-muted">
                <X className="size-5" />
              </button>
            </div>
            {groups.map((g) => (
              <div key={g.label} className="border-b border-line py-1">
                {g.pages.length > 1 && <div className="px-4 pt-2 pb-1 text-[12px] text-muted">{g.label}</div>}
                {g.pages.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex min-h-11 items-center gap-3 px-4 text-[14px]", isActive(p.href, path) ? "bg-brass-soft font-semibold text-brass-ink" : "hover:bg-hover")}
                  >
                    <p.icon className="size-4 text-muted" />
                    <span className="flex-1">{p.label}</span>
                    <Count n={badge(p.href)} />
                  </Link>
                ))}
              </div>
            ))}
            <div className="mt-auto p-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}

