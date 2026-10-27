import { DEFAULT_DASHBOARD, getDashboard, setDashboard } from "./settings.js";
import { APPLICATION_SITES } from "./sites/apply.js";
import { createVault, deleteLogin, deleteVault, listLogins, lockVault, saveLogin, setVaultOn, unlockVault, vaultStatus } from "./vault.js";

const $ = (id) => document.getElementById(id);

/* Dashboard address */
const input = $("dashboard");
input.value = await getDashboard();
$("save").addEventListener("click", async () => {
  try {
    input.value = await setDashboard(input.value);
    $("status").textContent = "Saved.";
  } catch (e) {
    $("status").textContent = e.message;
  }
});
$("reset").addEventListener("click", async () => {
  input.value = await setDashboard(DEFAULT_DASHBOARD);
  $("status").textContent = "Back to the default.";
});

/* Application sites (optional host permissions; asked from this click) */
const PATTERNS = APPLICATION_SITES.map((s) => `https://*.${s}/*`);
async function showSites() {
  const allowed = [];
  for (const p of PATTERNS) if (await chrome.permissions.contains({ origins: [p] })) allowed.push(p);
  $("sitesStatus").textContent = allowed.length
    ? `Allowed on ${allowed.length} of ${PATTERNS.length}: ${allowed.map((p) => p.slice(10, -2)).join(", ")}.`
    : "Not allowed on any application site yet.";
}
$("allowSites").addEventListener("click", () => {
  chrome.permissions.request({ origins: PATTERNS }).then(showSites, (e) => ($("sitesStatus").textContent = e.message));
});
$("removeSites").addEventListener("click", () => {
  chrome.permissions.remove({ origins: PATTERNS }).then(showSites);
});
showSites();

/* Saved logins */
const say = (t) => ($("vaultStatus").textContent = t);
async function showVault() {
  const st = await vaultStatus();
  $("vaultOn").checked = st.on;
  $("vaultBody").hidden = !st.on;
  if (!st.on) return;
  $("pinBox").hidden = st.unlocked;
  $("logins").hidden = !st.unlocked;
  $("pinLabel").textContent = st.hasPin ? "PIN (unlocks your saved logins until the browser closes)" : "Choose a PIN (6+ characters; it can't be recovered)";
  $("pinGo").textContent = st.hasPin ? "Unlock" : "Set PIN";
  if (st.unlocked) {
    const list = await listLogins();
    $("loginList").replaceChildren(
      ...(list.length
        ? list.map((l) => {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = `${new URL(l.origin).hostname} · ${l.username}`;
            const del = document.createElement("button");
            del.className = "secondary";
            del.textContent = "Delete";
            del.addEventListener("click", async () => {
              await deleteLogin(l.origin, l.username);
              showVault();
            });
            li.append(name, del);
            return li;
          })
        : [Object.assign(document.createElement("li"), { textContent: "No saved logins yet.", className: "muted" })]),
    );
  }
}
$("vaultOn").addEventListener("change", async (e) => {
  await setVaultOn(e.target.checked);
  say(e.target.checked ? "" : "Off: Coverage won't sign in for you. Your saved logins stay encrypted until you delete them.");
  showVault();
});
$("pinGo").addEventListener("click", async () => {
  try {
    const st = await vaultStatus();
    if (st.hasPin) await unlockVault($("pin").value);
    else await createVault($("pin").value);
    $("pin").value = "";
    say("Unlocked until the browser closes.");
    showVault();
  } catch (e) {
    say(e.message);
  }
});
$("lAdd").addEventListener("click", async () => {
  try {
    const origin = await saveLogin($("lSite").value, $("lUser").value.trim(), $("lPass").value);
    $("lSite").value = $("lUser").value = $("lPass").value = "";
    say(`Saved for ${new URL(origin).hostname} only.`);
    showVault();
  } catch (e) {
    say(e.message);
  }
});
$("lock").addEventListener("click", async () => {
  await lockVault();
  say("Locked.");
  showVault();
});
$("wipe").addEventListener("click", async () => {
  if ($("wipe").dataset.armed !== "1") {
    $("wipe").dataset.armed = "1";
    $("wipe").textContent = "Click again to delete them all";
    return;
  }
  await deleteVault();
  say("Deleted every saved login and the PIN.");
  showVault();
});
showVault();

/* LinkedIn / Handshake job search (test build only; the store build strips these sections and has no access to either site) */
function siteToggle(box, status, origin, flag, button) {
  if (!box) return;
  const show = async () => {
    const flags = await chrome.storage.local.get(flag);
    box.checked = flags[flag] === true && (await chrome.permissions.contains({ origins: [origin] }).catch(() => false));
  };
  box.addEventListener("change", () => {
    if (box.checked) {
      // Asked straight from the click (permission requests need the gesture).
      chrome.permissions.request({ origins: [origin] }).then(async (ok) => {
        await chrome.storage.local.set({ [flag]: ok });
        status.textContent = ok ? `On. Reload your Coverage tab to see “${button}”.` : "Not allowed.";
        show();
      });
    } else {
      chrome.storage.local.set({ [flag]: false });
      chrome.permissions.remove({ origins: [origin] }).catch(() => {});
      status.textContent = "Off.";
    }
  });
  show();
}
siteToggle($("liOn"), $("liStatus"), "https://www.linkedin.com/*", "linkedinAgent", "Search LinkedIn");
siteToggle($("hsOn"), $("hsStatus"), "https://*.joinhandshake.com/*", "handshakeAgent", "Search Handshake");
