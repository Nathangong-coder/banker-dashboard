"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { LOGO_MAX_BYTES, LOGO_TYPES, logoAnchor } from "@/lib/signatureLogo";
import type { SignatureLogoHtml } from "@/lib/emailFormat";
import { Button, Field, Input, toast } from "./ui";

/** The saved logo as an object URL for previews (re-read when it's replaced). */
export function useSignatureLogoPreview(): SignatureLogoHtml | undefined {
  const settings = useStore((s) => s.settings);
  const meta = settings.emailStyle.logo;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let made: string | undefined;
    if (!meta) return; // the hook returns undefined without a logo, whatever `url` still holds
    void blobs.logo().then((img) => {
      if (!alive || !img) return;
      made = URL.createObjectURL(new Blob([img.data], { type: img.type }));
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [meta?.addedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!meta || !url) return undefined;
  return { src: url, width: meta.width, link: meta.link, alt: meta.name, after: logoAnchor(settings) };
}

/**
 * Upload a logo that goes under the signature in every Gmail draft (embedded as an inline image, so it shows even
 * when the recipient blocks remote images). PNG / JPG / GIF up to 1 MB; Gmail doesn't show SVG.
 */
export function SignatureLogoEditor() {
  const meta = useStore((s) => s.settings.emailStyle.logo);
  const setSettings = useStore((s) => s.setSettings);
  const input = useRef<HTMLInputElement>(null);
  const setMeta = (patch: Partial<NonNullable<typeof meta>> | null) =>
    setSettings((s) => ({ ...s, emailStyle: { ...s.emailStyle, logo: patch === null ? undefined : { ...s.emailStyle.logo!, ...patch } } }));

  const onFile = async (f: File) => {
    if (!LOGO_TYPES.includes(f.type)) return toast.err("Use a PNG, JPG or GIF. Gmail doesn't show SVG images.");
    if (f.size > LOGO_MAX_BYTES) return toast.err("That image is over 1 MB. Export a smaller version (a few hundred pixels wide is plenty).");
    await blobs.setLogo({ name: f.name, type: f.type, data: await f.arrayBuffer() });
    setSettings((s) => ({ ...s, emailStyle: { ...s.emailStyle, logo: { width: s.emailStyle.logo?.width ?? 120, link: s.emailStyle.logo?.link, name: f.name, addedAt: new Date().toISOString() } } }));
    toast.ok(`Logo added. New and updated Gmail drafts get it under your signature.`);
  };

  return (
    <Field
      label="Logo under your signature (optional)"
      hint="PNG, JPG or GIF, up to 1 MB. Embedded in each Gmail draft, so it shows even when images from the web are blocked. Drafts already in Gmail get it when you update them."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => input.current?.click()}>
          {meta ? "Replace logo" : "Upload logo"}
        </Button>
        {meta && (
          <>
            <span className="max-w-[200px] truncate text-[12px] text-muted" title={meta.name}>
              {meta.name}
            </span>
            <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
              Width
              <input
                type="range"
                min={40}
                max={300}
                step={5}
                value={meta.width}
                onChange={(e) => setMeta({ width: Number(e.target.value) })}
                className="accent-navy"
                aria-label="Logo width"
              />
              <span className="num w-10">{meta.width}px</span>
            </label>
            <Input
              className="h-8 w-56"
              value={meta.link ?? ""}
              placeholder="Link (optional, https://…)"
              onChange={(e) => setMeta({ link: e.target.value || undefined })}
              aria-label="Logo link"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                await blobs.setLogo(undefined);
                setMeta(null);
                toast.info("Logo removed. New and updated drafts won't have it.");
              }}
            >
              Remove
            </Button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={LOGO_TYPES.join(",")}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </div>
      {meta?.link && !/^https:\/\//.test(meta.link) && <p className="mt-1 text-[11.5px] text-red">The link needs to start with https:// (it&rsquo;s left off until then).</p>}
    </Field>
  );
}
