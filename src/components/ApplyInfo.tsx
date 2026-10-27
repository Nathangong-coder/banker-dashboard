"use client";

import { ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { openVault } from "@/lib/vaultCrypto";
import type { ApplyProfile } from "@/lib/apply";
import { Button, Card, CardHeader, Field, Input, Select, Textarea, toast } from "./ui";

/**
 * Applications → My info: what the extension types into application forms. Kept in this browser only; a form gets
 * a value only when its question matches (src/lib/apply.ts#planFill). The AI never sees the sensitive sections.
 */

type Key = keyof ApplyProfile;
type Opt = readonly (readonly [string, string])[];

const YES_NO: Opt = [
  ["", "Leave for me"],
  ["yes", "Yes"],
  ["no", "No"],
];
const SELF_ID = (extra: Opt): Opt => [["", "Leave for me"], ...extra, ["decline", "Prefer not to say"]];
const GENDER = SELF_ID([
  ["female", "Female"],
  ["male", "Male"],
  ["nonbinary", "Non-binary"],
]);
const RACE = SELF_ID([
  ["asian", "Asian"],
  ["black", "Black or African American"],
  ["hispanic", "Hispanic or Latino"],
  ["white", "White"],
  ["native", "American Indian or Alaska Native"],
  ["pacific", "Native Hawaiian or Pacific Islander"],
  ["two_or_more", "Two or more races"],
]);
const YN_DECLINE = SELF_ID([
  ["yes", "Yes"],
  ["no", "No"],
]);
const VETERAN = SELF_ID([
  ["no", "Not a protected veteran"],
  ["yes", "Protected veteran"],
]);
const DISABILITY = SELF_ID([
  ["no", "No disability"],
  ["yes", "Yes, I have a disability"],
]);

export function ApplyInfo() {
  const profile = useStore((s) => s.apply.profile);
  const mine = useStore((s) => s.settings.profile);
  const setApply = useStore((s) => s.setApply);
  const save = (patch: Partial<ApplyProfile>) => setApply((a) => ({ ...a, profile: { ...a.profile, ...patch } }));

  // Text saves on blur (every keystroke would rewrite the whole saved state).
  const text = (k: Key, label: string, opts: { placeholder?: string; type?: string; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <Input
        key={`${k}:${profile[k]}`}
        type={opts.type ?? "text"}
        defaultValue={profile[k]}
        placeholder={opts.placeholder}
        onBlur={(e) => e.target.value.trim() !== profile[k] && save({ [k]: e.target.value.trim() } as Partial<ApplyProfile>)}
      />
    </Field>
  );
  const choice = (k: Key, label: string, options: Opt, hint?: string) => (
    <Field label={label} hint={hint}>
      <Select value={profile[k] ?? ""} onChange={(e) => save({ [k]: e.target.value } as Partial<ApplyProfile>)} aria-label={label}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
  const area = (k: Key, label: string, rows: number, placeholder: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Textarea key={`${k}:${profile[k].length}`} rows={rows} defaultValue={profile[k]} placeholder={placeholder} onBlur={(e) => e.target.value !== profile[k] && save({ [k]: e.target.value } as Partial<ApplyProfile>)} />
    </Field>
  );

  const fromProfile = () => {
    const [first, ...rest] = mine.name.trim().split(/\s+/);
    const patch: Partial<ApplyProfile> = {};
    const put = (k: Key, v: string) => {
      if (v && !profile[k]) patch[k] = v;
    };
    put("firstName", first ?? "");
    put("lastName", rest.join(" "));
    put("email", mine.email);
    put("phone", mine.phone);
    put("linkedin", mine.linkedin);
    put("school", mine.school);
    put("major", mine.major);
    if (/^\d{4}$/.test(mine.year.trim())) put("gradDate", `${mine.year.trim()}-06`);
    if (!Object.keys(patch).length) return toast.info("Nothing new to copy: those fields are already filled in.");
    save(patch);
    toast.ok(`Copied ${Object.keys(patch).length} field${Object.keys(patch).length > 1 ? "s" : ""} from Settings → Profile.`);
  };

  const grid = "grid grid-cols-[minmax(0,1fr)] gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
        <ShieldCheck className="size-4 text-green" />
        Saved in this browser only. The extension types a value only into a question that matches it, and you review the form before you submit. The AI
        that drafts open answers sees your education, background and writing, never the address, contact, work authorization or self-identification
        answers below.
        <div className="flex-1" />
        <Button size="sm" variant="secondary" icon={<UserRound className="size-3.5" />} onClick={fromProfile}>
          Copy from my profile
        </Button>
      </div>

      <Card>
        <CardHeader title="Contact" />
        <div className={grid}>
          {text("firstName", "Legal first name")}
          {text("lastName", "Last name")}
          {text("preferredName", "Preferred name", { hint: "Blank = your first name." })}
          {text("email", "Email", { type: "email" })}
          {text("phone", "Phone", { type: "tel" })}
          {text("linkedin", "LinkedIn URL", { placeholder: "https://www.linkedin.com/in/…" })}
          {text("website", "Website / portfolio")}
        </div>
      </Card>

      <Card>
        <CardHeader title="Home address" />
        <div className={grid}>
          {text("address1", "Street address")}
          {text("address2", "Apt / unit")}
          {text("city", "City")}
          {text("state", "State", { placeholder: "WA", hint: "Two letters or the full name." })}
          {text("zip", "ZIP code")}
          {text("country", "Country")}
        </div>
      </Card>

      <Card>
        <CardHeader title="Education" />
        <div className={grid}>
          {text("school", "School")}
          {text("degree", "Degree", { placeholder: "Bachelor of Arts" })}
          {text("major", "Major")}
          {text("gpa", "GPA", { placeholder: "3.8" })}
          <Field label="Expected graduation" hint="The date forms get for graduation / education end date.">
            <Input
              key={`gradDate:${profile.gradDate}`}
              type="date"
              // Saved before full dates (month only) shows as the 15th.
              defaultValue={/^\d{4}-\d{2}$/.test(profile.gradDate) ? `${profile.gradDate}-15` : profile.gradDate}
              onBlur={(e) => e.target.value && e.target.value !== profile.gradDate && save({ gradDate: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Work authorization" sub="Answered only by these settings, never guessed. Leave one blank to answer it yourself on each form." />
        <div className={grid}>
          {choice("authorized", "Authorized to work in the U.S.?", YES_NO)}
          {choice("sponsorNow", "Need visa sponsorship now?", YES_NO)}
          {choice("sponsorFuture", "Need sponsorship in the future?", YES_NO)}
          {text("citizenship", "Citizenship / visa status", { placeholder: "U.S. citizen", hint: "Typed as written when a form asks." })}
          {choice("over18", "At least 18?", YES_NO)}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Voluntary self-identification"
          sub="The EEO questions most forms end with. “Leave for me” skips the question so you answer it each time; “Prefer not to say” picks the form's decline option."
        />
        <div className={grid}>
          {choice("gender", "Gender", GENDER)}
          {choice("race", "Race / ethnicity", RACE)}
          {choice("hispanic", "Hispanic or Latino?", YN_DECLINE)}
          {choice("veteran", "Veteran status", VETERAN)}
          {choice("disability", "Disability status", DISABILITY)}
          {choice("transgender", "Transgender?", YN_DECLINE)}
          {text("orientation", "Sexual orientation", { hint: "Typed or matched as written; blank = leave for me." })}
          {text("pronouns", "Pronouns")}
        </div>
      </Card>

      <Card>
        <CardHeader title="Other common questions" />
        <div className={grid}>
          {text("howHeard", "How did you hear about us?", { placeholder: "Company website" })}
          {choice("relocate", "Willing to relocate?", YES_NO)}
          {text("startDate", "Available to start", { placeholder: "June 2027" })}
          {choice("driversLicense", "Valid driver's license?", YES_NO)}
        </div>
      </Card>

      <Card>
        <CardHeader title="About you (for AI drafts)" sub="The only facts the AI may use for open questions. It won't invent anything that isn't here, in your answer library or writing samples." />
        <div className="grid gap-3 px-4 pb-4">
          {area(
            "background",
            "Your background",
            8,
            "Internships and what you did on them (deals, models, sectors), clubs and roles, coursework, skills, anything you'd put on a resume, in your own words.",
            "Your resume (Resumes tab) is read automatically each time; add what it doesn't say.",
          )}
          {area("interests", "Why banking, and what you want", 4, "Why IB, the groups and offices you want, firms you've talked to and what stood out.")}
          {area("styleNotes", "How you write", 3, "e.g. Short sentences, specific examples, no buzzwords, confident but not stiff.", "Your writing samples (Writing tab) show it; this says it.")}
        </div>
      </Card>

      <CreatedAccounts />
    </div>
  );
}

/**
 * Accounts the extension created on application sites ("Create accounts for me"). The passwords are only in the
 * extension's PIN-locked saved logins (synced encrypted through your account): "Show password" asks for the PIN and
 * opens the vault in this tab for 30 seconds (lib/vaultCrypto.ts). Nothing is stored unencrypted.
 */
function CreatedAccounts() {
  const accounts = useStore((s) => s.apply.accounts);
  const vault = useStore((s) => s.apply.vault);
  const [asking, setAsking] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [shown, setShown] = useState<{ key: string; password: string } | null>(null);
  if (!accounts?.length) return null;
  const reveal = async (origin: string, email: string) => {
    if (!vault?.blob) return toast.err("Your saved logins haven't synced to this account yet: open the extension's Options once.");
    try {
      const logins = await openVault(vault.blob, pin);
      const hit = logins.find((l) => l.origin === origin && l.username === email) ?? logins.find((l) => l.origin === origin);
      if (!hit) return toast.err("That login isn't in your saved logins (it may have been deleted).");
      setShown({ key: `${origin}|${email}`, password: hit.password });
      setAsking(null);
      setPin("");
      setTimeout(() => setShown(null), 30_000);
    } catch (e) {
      toast.err((e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader title="Accounts Coverage created" sub="Made on application sites with your email and a generated password. The passwords are kept in the extension's saved logins, locked with your PIN." />
      <ul className="divide-y divide-line border-t border-line">
        {accounts
          .slice()
          .reverse()
          .map((a) => {
            const key = `${a.origin}|${a.email}`;
            return (
              <li key={key} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <span className="font-medium text-ink">{a.company ?? new URL(a.origin).hostname}</span>
                <span className="text-muted">
                  {new URL(a.origin).hostname} · {a.email} · {new Date(a.at).toLocaleDateString()}
                  {a.verified ? " · email verified" : ""}
                </span>
                <div className="flex-1" />
                {shown?.key === key ? (
                  <>
                    <code className="rounded bg-subtle px-1.5 py-0.5 text-[12px]">{shown.password}</code>
                    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(shown.password).then(() => toast.ok("Copied."))}>
                      Copy
                    </Button>
                  </>
                ) : asking === key ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void reveal(a.origin, a.email);
                    }}
                  >
                    <Input type="password" autoFocus className="h-8 w-32" placeholder="Your PIN" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="Saved-logins PIN" />
                    <Button size="sm" variant="secondary" type="submit" disabled={pin.length < 6}>
                      Show
                    </Button>
                  </form>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setAsking(key)}>
                    Show password
                  </Button>
                )}
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
