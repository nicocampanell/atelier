// Unit check for Supabase JWT owner auth. No network: getUser is injected.
import assert from "node:assert/strict";
import { authenticate, requireUser } from "../lib/auth";

const req = (jwt?: string) => new Request("http://x/?token=abc", { headers: jwt ? { authorization: `Bearer ${jwt}` } : {} });
const user = (id: string, email: string) => async () => ({ data: { user: { id, email } }, error: null });

async function main() {
  process.env.ATELIER_OWNER_EMAIL = "Owner@Example.com";

  // No Authorization (and ?token= is ignored) → null / 401, without touching Supabase.
  const boom = async () => { throw new Error("getUser must not be called"); };
  assert.equal(await authenticate(req(), boom as never), null);
  const denied = await requireUser(req());
  assert.ok(denied instanceof Response && denied.status === 401);

  // Owner (case-insensitive) → Supabase uuid.
  assert.equal(await authenticate(req("jwt"), user("uuid-1", "owner@example.com")), "uuid-1");
  // Other user → null.
  assert.equal(await authenticate(req("jwt"), user("uuid-2", "evil@example.com")), null);
  // Supabase rejects the JWT → null.
  assert.equal(await authenticate(req("jwt"), async () => ({ data: { user: null }, error: new Error("bad") })), null);
  // No owner configured → null.
  delete process.env.ATELIER_OWNER_EMAIL;
  assert.equal(await authenticate(req("jwt"), user("uuid-1", "owner@example.com")), null);

  console.log("verify-auth-supabase: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
