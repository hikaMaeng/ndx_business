# Three layers, real skills, one session index

## Goal

Everything before this used bundles this repository wrote, which only shows the
code survives the shapes it already expects. This uses skills published for
other people: their own frontmatter, their own folder layouts, their own scripts
and references, none of it arranged to suit us.

What is under test is the **composition**. An organisation configures skills for
everyone beneath it, a person configures their own, a project configures its
own — and a session opened in that project must end up with the union, the
nearer layer winning where two name the same skill, and every path pointing at
files the tool container can actually read.

The last part matters most and is the easiest to skip: it is not enough that
`skillIndex` returns the right thing. A session has to *get* it. Those are two
claims, so the run checks them separately — the composer directly, and then the
`context_suffix` a real session stored.

## Skills used

From `anthropics/skills`, chosen for what they are made of rather than for what
they do:

| Skill | Files | Shape | Why this one |
| --- | --- | --- | --- |
| `mcp-builder` | 10 | `reference/`, `scripts/` | both nested kinds, modest size |
| `skill-creator` | 18 | `references/`, `scripts/`, `agents/`, `assets/`, `eval-viewer/` | five folders, none of which this code was written against |
| `pdf` | 12 | `scripts/` | the contested name, uploaded twice |
| `webapp-testing` | 6 | `examples/`, `scripts/` | a folder name nothing here anticipated |
| `canvas-design` | 83 | `canvas-fonts/` | 54 real binary files, 2.6 MB zip — the first upload big enough to test the ceiling instead of assuming it |
| `docx` | 61 | `scripts/office/...` | six levels deep, and 61 files that are all text |

## Placement

| Layer | Skills |
| --- | --- |
| Organisation | `mcp-builder`, `skill-creator` |
| Account (personal global) | `pdf`, `webapp-testing`, `canvas-design` |
| Project | `docx`, `pdf` |

`pdf` is in two layers deliberately. Without a contested name the merge has no
decision to make, and a merge that never decides anything passes any test.

## Environment

| | |
| --- | --- |
| Stack | `npm run deploy -- --all`, six services |
| Admin | `http://127.0.0.1:18080` |
| Vibeagent | `http://127.0.0.1:18081` |
| Source | a checkout of `anthropics/skills` |
| Browser | Playwright chromium, headless, `en-US` |

## Preconditions

- Six services healthy.
- Signup acceptance is `auto`; the run creates its own account rather than
  borrowing one, which would mean a password written down somewhere.

## Steps

1. Sign up, sign in.
2. Seed an organisation, membership, and a `subtree` responsibility for the
   account. Seeded because creating a root organisation is a master-admin
   action and who may create one is not what this is about.
3. Create the project **through vibeagent** (`POST /api/vibe/workspaces`) —
   that route asks admin for the record first and creates the folder only once
   the name and the organisation claim are accepted.
4. Zip each skill folder and upload it to its layer.
5. Read each bundle back: folders, depth, which files are editable.
6. Ask admin for the merged policy (`GET /api/projects/:name/policy`).
7. Run the merged entries through the real `skillIndex`/`composeSuffix`.
8. Read every listed path from inside `worker-tool`, and try to write one.
9. Open a session in the vibeagent client on that project, and read
   `vibe_session.context_suffix` back from the database.

## Expected results

| Step | Expected |
| --- | --- |
| 4 | every file in every zip lands — 10, 18, 12, 6, 83, 61 |
| 4 | each row's description equals the skill's own frontmatter, typed by nobody |
| 5 | `references/`, `scripts/`, `agents/` survive as folders; `SKILL.md` leads |
| 5 | a six-deep path survives; 54 fonts listed and not editable; 28 `.txt` beside them editable |
| 6 | six skills, `pdf` once, won by the project, with the account copy recorded as shadowed |
| 7 | six entries, each path in its own layer's folder, `pdf` pointing at the project's |
| 8 | all six `SKILL.md` readable; a write refused with `Read-only file system` |
| 9 | the stored suffix names all six with the same paths, `pdf` exactly once, and equals what the composer produced |

## Logs to capture

- Deploy summary lines.
- Every check with its detail; upload sizes and file counts.
- The composed index (`session-index.md`) and the stored one
  (`stored-suffix.md`), so they can be compared by eye as well as by assertion.
- A screenshot of the opened session.
