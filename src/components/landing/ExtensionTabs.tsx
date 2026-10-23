"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/util";

const TABS = [
  ["/extension", "Overview"],
  ["/extension/privacy", "Privacy"],
  ["/extension/support", "Help & support"],
] as const;

/** The /extension section's own tab row, under the landing nav. */
export function ExtensionTabs() {
  const path = usePathname();
  return (
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex h-12 max-w-6xl items-stretch gap-1 overflow-x-auto px-4">
        <span className="mr-3 flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink">
          <Puzzle className="size-4 text-brass-ink" aria-hidden="true" /> Browser extension
        </span>
        <nav aria-label="Browser extension" className="flex items-stretch">
          {TABS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              className={cn(
                "relative inline-flex shrink-0 items-center px-3 text-[13px] whitespace-nowrap text-ink-2 hover:text-ink",
                path === href && "font-medium text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-t after:bg-brass",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
