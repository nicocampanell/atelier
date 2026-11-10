// Adapted from Pond (MIT) apps/extension/entrypoints/popup/app/index.tsx @ deb305e
import { useCallback, useEffect, useState } from "react";
import type { Project } from "../../../lib/types";
import type { ExtensionSettings, SourceId } from "../../lib/contracts";
import { apiFetch } from "../../utils/api";
import { getSettings, setSettings } from "../../utils/settings";
import { signIn } from "./signin";

const SITES: { id: SourceId; label: string }[] = [
  { id: "pinterest", label: "Pinterest" },
  { id: "arena", label: "Are.na" },
  { id: "twitter", label: "X" },
  { id: "instagram", label: "Instagram" },
];

export function App() {
  const [settings, setLocal] = useState<ExtensionSettings | null>(null);
  useEffect(() => void getSettings().then(setLocal), []);
  if (!settings) return null;
  return (
    <main>
      <h1>Atelier</h1>
      {settings.token ? (
        <SignedIn settings={settings} onChange={setLocal} />
      ) : (
        <SignIn onDone={() => void getSettings().then(setLocal)} initialServer={settings.serverUrl} />
      )}
    </main>
  );
}

function SignIn({ onDone, initialServer }: { onDone: () => void; initialServer: string }) {
  const [server, setServer] = useState(initialServer);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await signIn(server, token);
        setBusy(false);
        if (r.ok) onDone();
        else setError(r.message);
      }}
    >
      <label>
        Server
        <input data-testid="server" value={server} onChange={(e) => setServer(e.target.value)} spellCheck={false} />
      </label>
      <label>
        Access token
        <input data-testid="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      {error && <p role="alert" className="error" data-testid="error">{error}</p>}
      <button type="submit" disabled={busy} data-testid="signin">{busy ? "Checking…" : "Sign in"}</button>
    </form>
  );
}

function SignedIn({ settings, onChange }: { settings: ExtensionSettings; onChange: (s: ExtensionSettings) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<{ projects: Project[] }>(settings, "/api/projects");
    if (r.ok) setProjects(r.data.projects);
    else setError(r.error.message);
  }, [settings]);
  useEffect(() => void load(), [load]);

  const patch = async (p: Partial<ExtensionSettings>) => onChange(await setSettings(p));

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    const r = await apiFetch<Project>(settings, "/api/projects", { method: "POST", json: { name: n } });
    setCreating(false);
    if (!r.ok) return setError(r.error.message);
    setName("");
    setError(null);
    setProjects((cur) => [r.data, ...(cur ?? [])]);
    await patch({ projectId: r.data.id });
  };

  return (
    <>
      <section>
        <h2>Save to</h2>
        <div role="radiogroup" aria-label="Project" className="list">
          {(projects ?? []).map((p) => (
            <label key={p.id} className="option">
              <input type="radio" name="project" data-testid="project" checked={settings.projectId === p.id} onChange={() => void patch({ projectId: p.id })} />
              <span>{p.name}</span>
            </label>
          ))}
          <label className="option">
            <input type="radio" name="project" data-testid="library-only" checked={settings.projectId === null} onChange={() => void patch({ projectId: null })} />
            <span>Library only</span>
          </label>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input data-testid="new-project" placeholder="New project" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <button type="submit" disabled={creating || !name.trim()} data-testid="create-project">Add</button>
        </form>
        {error && <p role="alert" className="error" data-testid="error">{error}</p>}
      </section>
      <section>
        <h2>Save from sites</h2>
        {SITES.map((s) => (
          <label key={s.id} className="option">
            <input type="checkbox" checked={settings.hooks[s.id]} onChange={(e) => void patch({ hooks: { ...settings.hooks, [s.id]: e.target.checked } })} />
            <span>{s.label}</span>
          </label>
        ))}
      </section>
      <button type="button" className="quiet" data-testid="signout" onClick={() => void patch({ token: null, projectId: null })}>
        Sign out
      </button>
    </>
  );
}
