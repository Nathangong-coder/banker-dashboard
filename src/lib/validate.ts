/**
 * Field checks shared by the forms (Add contact, Settings → Profile). Each returns an error message, or undefined
 * when the value is fine. Empty is fine unless `required` (the forms mark required fields themselves).
 * The server validates its own inputs separately with zod (app/api/*).
 */

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function checkEmail(v: string, required = false) {
  const s = v.trim();
  if (!s) return required ? "Enter an email address." : undefined;
  if (!EMAIL.test(s)) return "That doesn't look like an email address (name@firm.com).";
  return undefined;
}

export function checkLinkedIn(v: string, required = false) {
  const s = v.trim();
  if (!s) return required ? "Enter a LinkedIn URL." : undefined;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return "Enter a full LinkedIn URL, like https://www.linkedin.com/in/name.";
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return "That isn't a linkedin.com link.";
  if (!/^\/(in|pub)\/[^/]+/i.test(u.pathname)) return "Use a profile link (linkedin.com/in/…), not a search or company page.";
  return undefined;
}

export function checkPhone(v: string) {
  const s = v.trim();
  if (!s) return undefined;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || /[^\d\s()+.-]/.test(s)) return "Use digits, spaces, dashes or + (e.g. 425-555-0123).";
  return undefined;
}

export function checkName(v: string) {
  const s = v.trim();
  if (!s) return "Enter a name.";
  if (s.length > 120) return "That's too long for a name.";
  if (/[<>{}]/.test(s) || /https?:\/\//i.test(s)) return "A name can't contain links or < > { }.";
  return undefined;
}

export function checkText(v: string, max: number, label: string) {
  return v.length > max ? `${label} is too long (max ${max} characters).` : undefined;
}
