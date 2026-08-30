# Enforcement in both directions, and what running a skill actually means

Two plans in one file because they are the two halves of the same question:
which skills a session gets, and whether they work once it has them.

## Part one — which layer wins

### Goal

The layer story points two ways at once, and a merge that only ever moved one
way would pass a test that only ever asked one way:

- **default** — the *nearest* layer wins. A project setting beats a personal
  global one, which beats an organisation's. This is what makes a default a
  suggestion.
- **enforced** — the *outermost* organisation wins, and beats every personal
  layer no matter how near. This is what lets a business bind its people.

Every case is therefore set up with something nearer already in place. An answer
is only interesting when there was another candidate.

### Environment

Six services deployed; a fresh account; a root organisation with a child under
it; a project running under the **child**, so the root is one step further away
than the organisation the project belongs to.

### Cases

| # | Setup | Expected |
| --- | --- | --- |
| 1 | root: `mcp-builder` **enforced, disabled**. child, account, project: all enabled | root wins; three shadowed; the skill is absent from the index |
| 2 | root: `skill-creator` **enforced**, uncontested | root wins, mode still `enforced` |
| 3 | root: `pdf` default. child: `pdf` default | **child** wins — a root's default must not freeze anything |
| 4 | account: `webapp-testing` default. project: `webapp-testing` default | project wins |

Case 1 is the one that decides whether `enforced` means anything: three nearer
layers all want the skill enabled, and the session must end up without it.

Case 3 is its mirror. If a root's *default* also froze the child, the two modes
would be one mode with two names.

### Expected results

Beyond the table: the index must contain exactly `pdf`, `skill-creator` and
`webapp-testing`; each path must point at the winning layer's folder; and every
path must be a folder that exists on disk, checked from inside `worker-tool`.

## Part two — the execution contract

### Goal

The session index tells every session three things, and every `SKILL.md` is
written as though they were true:

1. The working directory is the project, not the skill.
2. The skill's own files are reached through the path in the index.
3. The skill's folder is read-only; output goes in the project.

If one of them is false, every skill in the deployment is wrong in the same way
and each will look like its own bug. So they are tested directly rather than
inferred.

### Method

A bundle written for this purpose — not taken from the catalogue, because the
contract is ours and no published skill is trying to prove it. It reads one of
its own reference files, writes a result into the project, tries to write beside
itself, and reports all of it.

Its scripts are then run inside `worker-tool` exactly as the prompt describes:
from the project directory, by the command the skill itself names.

### Expected results

| Check | Expected |
| --- | --- |
| `process.cwd()` | the project path |
| the script's own directory | inside the skill folder |
| a `references/` file | resolves relative to the script |
| writing beside itself | `EROFS` |
| the output file | lands in the project |
| the shipped `.sh` | **not** executable — zip carries no permission bit |
| running it directly | fails |
| `bash script.sh` | works |

The executable-bit pair is the reason the prompt says to read `SKILL.md` rather
than to run scripts directly. If an uploaded script were executable, an index
telling agents to run `./script.sh` would be right; it is not, so it does not.

### Also measured, not asserted

Which commands the catalogue's `SKILL.md` files name, and which of them the tool
container actually has. This is a fact about the image, and measuring it is how
the decision gets made rather than guessed.

## Logs to capture

- Every check with its detail.
- The resolved policy entries, including `origin` and `shadowed`.
- The contract report the skill wrote into the project.
- The interpreter table: what is asked for, what is present, and which skills
  cannot run as written.
