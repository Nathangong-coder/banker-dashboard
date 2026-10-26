// One-time sign-in. Opens a normal Chrome window (not automation-controlled, so Google allows the sign-in) on the
// demo profile. Sign into Google with your UCLA account, then into Coverage, then close the window.
// Playwright (explore.mjs / record.mjs) reuses this profile's cookies afterwards.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { CHROME, PROFILE, SITE } from "./config.mjs";

mkdirSync(PROFILE, { recursive: true });
const child = spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://accounts.google.com/AccountChooser?Email=nagong1@ucla.edu",
    `${SITE}/api/auth/google/start?returnTo=/&hint=nagong1@ucla.edu`,
    "https://calendar.google.com/calendar/u/0/r",
    "https://mail.google.com/mail/u/0/",
  ],
  { stdio: "ignore" },
);
console.log("Chrome is open on the demo profile. Sign in to Google (nagong1@ucla.edu), then to Coverage, then close Chrome.");
child.on("exit", () => console.log("Chrome closed. Profile saved."));
