"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { canonBank } from "@/lib/banks";
import { isPrivateEquity } from "@/lib/bankTabs";

export type FirmKind = "bank" | "pe";

/** Bank vs private equity for any firm name, from the workbook's lists (tiers) and banks added on /coverage. */
export function useFirmKinds() {
  const targets = useStore((s) => s.targets);
  const added = useStore((s) => s.coverage.added);
  return useMemo(() => {
    const tier = new Map<string, string>();
    for (const t of [...targets, ...added]) if (t.tier && !tier.has(canonBank(t.name))) tier.set(canonBank(t.name), t.tier);
    return (firm: string): FirmKind => (isPrivateEquity(tier.get(canonBank(firm))) ? "pe" : "bank");
  }, [targets, added]);
}
