import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = "https://banker-dashboard-three.vercel.app";
export const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const PROFILE = path.join(HERE, "profile");
export const RAW = path.join(HERE, "raw");
export const OUT = path.join(HERE, "out");

/** The throwaway contact used in the demo. The email is the owner's alt address, so the test email goes to them. */
export const TEST_CONTACT = {
  name: "Test Account",
  bank: "Evercore",
  email: "ngong7053@gmail.com",
  position: "Analyst",
  location: "SF",
  team: "Tech",
};

/** Same profile flags for every Playwright launch: real Chrome, no "controlled by automated software" bar. */
export const LAUNCH = {
  channel: "chrome",
  headless: false,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled", "--window-size=1920,1160", "--window-position=0,0", "--no-first-run"],
};
