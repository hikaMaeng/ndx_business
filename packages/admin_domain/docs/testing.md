# Testing

Use package-local tests for domain invariants and state transitions.

Keep app tests focused on HTTP, framework lifecycle, asset serving, and
integration boundaries.

Organization acceptance covers master, `node`, `subtree`, and unrelated actors.
It must pair each capability assertion with its mutation result, including
root/child creation, deletion, account listing, and `subtree` delegation.

Model endpoint acceptance uses a mocked provider response to verify the derived
models URL/header, exclusion of `embedding`, manual model creation, and
persistence of every model option through the app HTTP boundary.

Organization model acceptance attaches a refreshed endpoint, verifies its
complete model set (including later-added endpoint models) starts active,
changes one local active flag, and removes the node-to-service relation without
deleting the global endpoint.
