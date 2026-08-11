# Internals

## Decisions

- **Responsibility is an exclusive three-state value.** A node member has no
  admin scope, `node`, or `subtree`; selecting one scope replaces the other.
  Why: this preserves the persisted primary key and prevents contradictory
  `admin` plus `admin all` rows.
- **Node appearance uses validated identifiers.** Color and icon persist as
  closed-set tokens, not CSS values. Why: the browser consumes theme tokens and
  persisted data cannot inject presentation values.
- **Organization models are token-keyed.** React unmount only unsubscribes;
  navigation does not recreate the feature's domain state.
- **Provider discovery uses one models route per endpoint type.** Chat
  Completions, Responses, Anthropic Messages, and Gemini bases resolve to their
  sibling `/models` route. Why: the configured endpoint can remain the actual
  inference URL while discovery stays provider-specific.
- **Only generative identifiers enter the catalog.** Discovery discards any
  identifier containing `embedding`. Why: these rows expose generation controls
  that do not apply to embedding APIs.

## Organization authorization

- **Capabilities and enforcement share one policy source.** The server derives
  per-node UI capabilities from the same ancestor-aware `node` / `subtree`
  authority checks used by mutations. Why: the browser can hide unavailable
  actions without becoming the security boundary.
- **Destructive hierarchy operations stay master-only.** Delegated admins can
  never create roots or delete nodes; `subtree` delegation and child creation
  require inherited `subtree` authority. Why: delegated node management must
  not widen its own hierarchy or privilege boundary.

Add internals only when implementation details affect future maintenance.
