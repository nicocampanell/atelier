# Build from Atelier references

Start **Build from Atelier references** in the repository where you want to make the change. For another repository, copy `build-from-atelier.yaml` and its three `roles/reference_*` directories into that repository's `.paseo/plugins/playbooks/` directory. Configure the [Atelier MCP](../../../mcp/README.md) in Atelier for the provider used by the run. The inspector, builder, and independent reviewer each need access to the same saved references.

- **Source** accepts a hosted board name or ID, a saved reference ID, or its exact saved source URL. Separate multiple explicit references with commas.
- **Request** names the target component or screen and the change to make.
- **Mode** defaults to `visual` and requires a saved image. Choose `notes-only` to build from a hosted board's notes.
- **Intent** optionally assigns details to individual saves. For example, `layout: SAVE1; motion: SAVE2 at 0ms, SAVE3 at 180ms`. For motion, supply ordered screenshots and their observed timestamps. The playbook treats behavior between stills as an interpretation for approval.

Paseo isolates the build against the target repository's fetched remote base. Check that the base contains the target component or, for a new component, the project area where it belongs. If the definition comes from the workspace checkout, the isolated build still uses the remote base.

The approval gate shows the reference roles, observed evidence, and proposed adaptation before editing begins. If a required image cannot be opened or the target is absent, the inspection reports what blocked it. The final review includes verification evidence and the worktree location.
