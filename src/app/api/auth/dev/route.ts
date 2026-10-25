import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { createSession, saveUser, loadUser, type User } from "@/lib/server/users";

const Body = z.object({ email: z.string().email(), name: z.string().max(80).optional() });

/**
 * Local testing only (no Google): signs in as a throwaway user. Answers 404 unless the server was started with
 * COVERAGE_DEV_LOGIN=1 on this machine (127.0.0.1 / localhost), and always on Vercel.
 */
export async function POST(req: Request) {
  if (process.env.VERCEL || process.env.COVERAGE_DEV_LOGIN !== "1") return new Response("Not found", { status: 404 });
  const host = new URL(req.url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return new Response("Not found", { status: 404 });
  try {
    const b = Body.parse(await req.json());
    const id = `dev:${b.email.toLowerCase()}`;
    const now = new Date().toISOString();
    const u: User = (await loadUser(id)) ?? { id, email: b.email.toLowerCase(), name: b.name, createdAt: now };
    await saveUser({ ...u, lastSignInAt: now });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSession(req, id) } });
  } catch (e) {
    return errorResponse(e);
  }
}
