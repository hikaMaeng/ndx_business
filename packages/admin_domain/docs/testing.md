# Testing

Use package-local tests for domain invariants and state transitions.

Keep app tests focused on HTTP, framework lifecycle, asset serving, and
integration boundaries.

Organization acceptance covers master, `node`, `subtree`, and unrelated actors.
It must pair each capability assertion with its mutation result, including
root/child creation, deletion, account listing, and `subtree` delegation.

Model endpoint acceptance uses a mocked provider response to verify the derived
models URL/header, exclusion of `embedding`, and persistence of every model
option through the app HTTP boundary.
