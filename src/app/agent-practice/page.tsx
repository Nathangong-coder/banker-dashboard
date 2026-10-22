"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";

/**
 * A fake summer analyst application for the extension's agent test bench (extension/agent). Nothing leaves the page:
 * "Submit" only shows a confirmation number. It has what real application sites make hard for an agent: two steps,
 * required-field errors, a native dropdown, a custom (non-<select>) dropdown and a certification checkbox.
 */

const OFFICES = ["New York", "San Francisco", "Los Angeles", "Chicago", "Houston"];
const YEARS = ["2026", "2027", "2028", "2029", "2030"];

type Form = {
  first: string;
  last: string;
  email: string;
  school: string;
  year: string;
  gpa: string;
  office: string;
  linkedin: string;
  why: string;
  certify: boolean;
};
const EMPTY: Form = { first: "", last: "", email: "", school: "", year: "", gpa: "", office: "", linkedin: "", why: "", certify: false };

function OfficePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Office"
        onClick={() => setOpen(!open)}
        className="w-full rounded-md border border-line bg-panel px-3 py-2 text-left text-sm text-ink"
      >
        {value || "Choose an office"}
      </button>
      {open && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full rounded-md border border-line bg-panel py-1 shadow-lg">
          {OFFICES.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              tabIndex={0}
              onClick={() => (onChange(o), setOpen(false))}
              onKeyDown={(e) => e.key === "Enter" && (onChange(o), setOpen(false))}
              className="cursor-pointer px-3 py-1.5 text-sm text-ink hover:bg-hover"
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AgentPractice() {
  const [f, setF] = useState<Form>(EMPTY);
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [confirmation, setConfirmation] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const check = (keys: (keyof Form)[]) => {
    const e: Partial<Record<keyof Form, string>> = {};
    for (const k of keys) if (!f[k]) e[k] = "Required";
    if (keys.includes("email") && f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter a valid email";
    if (keys.includes("gpa") && f.gpa && !(Number(f.gpa) > 0 && Number(f.gpa) <= 4)) e.gpa = "GPA between 0 and 4.0";
    if (keys.includes("certify") && !f.certify) e.certify = "You must agree to continue";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper">
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-xs uppercase tracking-wide text-muted">Practice site · nothing is sent anywhere</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Example Partners: 2028 Summer Analyst</h1>
        <p className="mt-1 text-sm text-muted">A fake application for testing the Coverage browser agent.</p>

        {confirmation ? (
          <Card className="mt-6 p-6 text-center">
            <CheckCircle2 className="mx-auto size-8 text-brass-strong" />
            <h2 className="mt-2 text-lg font-semibold text-ink">Application submitted</h2>
            <p className="mt-1 text-sm text-ink-2">
              Thanks, {f.first}. Your confirmation number is <strong id="confirmation">{confirmation}</strong>.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => (setF(EMPTY), setStep(1), setConfirmation(""), setErrors({}))}>
              Start over
            </Button>
          </Card>
        ) : (
          <Card className="mt-6 space-y-4 p-6">
            <p className="text-sm font-medium text-ink">Step {step} of 2: {step === 1 ? "About you" : "Your application"}</p>
            {step === 1 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name" error={errors.first}>
                    <Input name="first_name" value={f.first} onChange={(e) => set("first", e.target.value)} />
                  </Field>
                  <Field label="Last name" error={errors.last}>
                    <Input name="last_name" value={f.last} onChange={(e) => set("last", e.target.value)} />
                  </Field>
                </div>
                <Field label="Email" error={errors.email}>
                  <Input name="email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field label="School" error={errors.school}>
                  <Input name="school" value={f.school} onChange={(e) => set("school", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Graduation year" error={errors.year}>
                    <Select name="graduation_year" value={f.year} onChange={(e) => set("year", e.target.value)}>
                      <option value="">Select…</option>
                      {YEARS.map((y) => (
                        <option key={y}>{y}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="GPA" error={errors.gpa}>
                    <Input name="gpa" inputMode="decimal" value={f.gpa} onChange={(e) => set("gpa", e.target.value)} />
                  </Field>
                </div>
                <Button variant="primary" onClick={() => check(["first", "last", "email", "school", "year", "gpa"]) && setStep(2)}>Next</Button>
              </>
            ) : (
              <>
                <Field label="Preferred office" error={errors.office}>
                  <OfficePicker value={f.office} onChange={(v) => set("office", v)} />
                </Field>
                <Field label="LinkedIn URL (optional)">
                  <Input name="linkedin" value={f.linkedin} onChange={(e) => set("linkedin", e.target.value)} />
                </Field>
                <Field label="Why Example Partners?" error={errors.why}>
                  <Textarea name="why" rows={4} value={f.why} onChange={(e) => set("why", e.target.value)} />
                </Field>
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input type="checkbox" name="certify" checked={f.certify} onChange={(e) => set("certify", e.target.checked)} className="mt-0.5" />
                  I certify that the information in this application is accurate.
                </label>
                {errors.certify && <p className="text-[11.5px] text-red">{errors.certify}</p>}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button variant="primary"
                    onClick={() =>
                      check(["office", "why", "certify"]) && setConfirmation(`EP-${Math.floor(100000 + Math.random() * 900000)}`)
                    }
                  >
                    Submit application
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
