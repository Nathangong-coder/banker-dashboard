/**
 * Structural workbook changes that cell patches can't express, pending until save (applied by buildWorkbook in this
 * order: renames, replaces, clones, row styles; then dropdowns and cell patches).
 */
export interface SheetOps {
  /** Tabs renamed (links to them are rewritten). */
  renames: { from: string; to: string }[];
  /** Existing tabs rebuilt from `from`'s layout (a malformed tab, e.g. a half-made copy); content comes from patches. */
  replaces: { name: string; from: string; after?: string }[];
  /** New tabs: copy `from`'s layout (no values), placed after `after`. */
  clones: { name: string; from: string; after?: string; bank: string }[];
  /** Copy a row's look (styles, height) from another row on the same tab. */
  rowStyles: { sheet: string; row: number; from: number }[];
}

export const EMPTY_OPS: SheetOps = { renames: [], replaces: [], clones: [], rowStyles: [] };

/** Older stored ops (before renames/replaces existed) get the missing lists. */
export const opsOf = (o?: Partial<SheetOps>): SheetOps => ({
  renames: o?.renames ?? [],
  replaces: o?.replaces ?? [],
  clones: o?.clones ?? [],
  rowStyles: o?.rowStyles ?? [],
});

export const hasOps = (o?: Partial<SheetOps>) => !!(o?.renames?.length || o?.replaces?.length || o?.clones?.length || o?.rowStyles?.length);
