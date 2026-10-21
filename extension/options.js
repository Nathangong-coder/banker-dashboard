import { DEFAULT_DASHBOARD, getDashboard, setDashboard } from "./settings.js";

const input = document.getElementById("dashboard");
const status = document.getElementById("status");

input.value = await getDashboard();

document.getElementById("save").addEventListener("click", async () => {
  try {
    input.value = await setDashboard(input.value);
    status.textContent = "Saved.";
  } catch (e) {
    status.textContent = e.message;
  }
});

document.getElementById("reset").addEventListener("click", async () => {
  input.value = await setDashboard(DEFAULT_DASHBOARD);
  status.textContent = "Back to the default.";
});
