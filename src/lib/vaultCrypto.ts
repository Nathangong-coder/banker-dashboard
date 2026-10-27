/**
 * Opens the extension's saved-logins vault in the dashboard with your PIN (Applications → My info → "Accounts Coverage
 * created" → Show password; owner, 2026-10-26: "store the password onto the dashboard"). Same scheme as
 * extension/vault.js: AES-GCM, key from the PIN via PBKDF2-SHA-256 (600,000 rounds) and the vault's salt. The PIN and
 * the decrypted logins live only in this function call: nothing is stored or sent anywhere.
 */
export interface VaultBlob {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}
export interface VaultLogin {
  origin: string;
  username: string;
  password: string;
  added?: string;
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function openVault(blob: VaultBlob, pin: string): Promise<VaultLogin[]> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(blob.salt), iterations: 600_000 }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.data));
    return JSON.parse(new TextDecoder().decode(plain)) as VaultLogin[];
  } catch {
    throw new Error("Wrong PIN.");
  }
}
