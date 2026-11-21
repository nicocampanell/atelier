/**
 * CRUD smoke against hosted Supabase (service role).
 * Skips when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ATELIER_VERIFY_USER_ID are missing.
 *
 * Manual setup:
 *   1. Apply supabase/migrations/20261119_init.sql and 20261119_search_segments.sql
 *   2. Create (or pick) an auth user; set ATELIER_VERIFY_USER_ID to that uuid
 *   3. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env
 *   4. pnpm exec tsx scripts/verify-db-supabase.ts
 *
 * Structural check without credentials: this file still typechecks via `pnpm typecheck`.
 */
import assert from "node:assert/strict";

function missing(...keys: string[]): string[] {
  return keys.filter((k) => !process.env[k]?.trim());
}

async function main() {
  const need = missing("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ATELIER_VERIFY_USER_ID");
  if (need.length) {
    console.log(`verify-db-supabase: SKIP (set ${need.join(", ")} for live CRUD)`);
    return;
  }

  const userId = process.env.ATELIER_VERIFY_USER_ID!.trim();
  const { createProject, listProjects, deleteProject } = await import("../lib/projects");
  const { createNoteSave, listSaves, deleteSave, getSave } = await import("../lib/saves");

  const before = await listProjects(userId);
  const project = await createProject(userId, `verify-${Date.now()}`);
  assert.ok(project.id && project.name.startsWith("verify-"));

  const note = await createNoteSave(userId, { note: "hello supabase", title: "Verify note" }, { projectId: project.id });
  assert.equal(note.kind, "note");
  assert.equal(note.status, "accepted");
  assert.equal(note.placedIn?.projectId, project.id);
  assert.ok(await getSave(userId, note.id));

  const listed = await listSaves(userId, { limit: 20 });
  assert.ok(listed.saves.some((s) => s.id === note.id));

  assert.equal(await deleteSave(userId, note.id), true);
  assert.equal(await getSave(userId, note.id), null);

  // Only delete the project we created if it isn't the sole remaining one.
  const afterCreate = await listProjects(userId);
  if (afterCreate.length > 1) {
    await deleteProject(userId, project.id);
  }
  const after = await listProjects(userId);
  assert.ok(after.length >= Math.min(1, before.length));

  console.log("verify-db-supabase: ok (project → note → list → delete)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
