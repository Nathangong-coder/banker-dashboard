"use client";

import { blobs, useStore } from "./store";
import { signatureBlock } from "./emailFormat";
import type { SignatureLogo } from "./gmail";
import type { Settings } from "./types";

/** Image types Gmail shows inline (no SVG: Gmail strips it). */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif"];
export const LOGO_MAX_BYTES = 1024 * 1024;

/** The signature's last line ("425-… | LinkedIn | you@school.edu"): the logo goes right under it. */
export function logoAnchor(s: Settings) {
  const lines = signatureBlock(s.profile).split("\n").filter((l) => l.trim());
  return lines[lines.length - 1] ?? "";
}

/** The logo saved in Settings → Email → Writing, ready for a Gmail draft (undefined = none). */
export async function savedSignatureLogo(): Promise<SignatureLogo | undefined> {
  const s = useStore.getState().settings;
  const meta = s.emailStyle.logo;
  if (!meta) return undefined;
  const img = await blobs.logo();
  if (!img) return undefined;
  return { type: img.type, data: img.data, width: meta.width, link: meta.link, alt: meta.name.replace(/\.[a-z0-9]+$/i, ""), after: logoAnchor(s) };
}
