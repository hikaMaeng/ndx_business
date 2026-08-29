# Skill bundles — upload, browse, edit

## Goal

A skill is a folder, and this verifies the three ways that folder is reached: a
zip arrives, its contents are listed, and one text file inside is changed and
saved. All three name a path chosen outside the system, so the plan also sends
the paths a person would not send.

Two claims are worth as much as the flow itself and are checked separately:

- **What a skill is made of is the skill's business.** Files with no blessed
  extension — a `Makefile`, a `.lua`, a `Dockerfile` — must open. A file whose
  name says text but whose bytes say otherwise must not.
- **The tool container cannot write to a skill.** Read-only is a mount, not a
  sentence in a prompt, so it is checked against the kernel.

## Environment

| | |
| --- | --- |
| Stack | `npm run deploy -- --all` (admin, vibeagent, four workers) |
| Admin | `http://127.0.0.1:18080` |
| Bundle root | `<data>/.ndx/skills` — admin read-write, worker-tool read-only |
| Browser | Playwright chromium, headless, viewport 1500×1000, locale `en-US` |
| Account | Created by the run itself; signup acceptance is `auto` |

The locale is pinned because the admin renders in the tester's language, and a
run that reads a translation to find a field fails when someone changes a word.

## Preconditions

- The stack is deployed and all six services report healthy.
- `admin.auth_settings.signup_acceptance_mode` is `auto`. If it is not, the run
  must stop rather than proceed as an account it did not create.

## Locator contract

Structure-dependent selectors are not used. The markup declares:

| Hook | Element |
| --- | --- |
| `auth-email`, `auth-password`, `auth-signup` | Sign-in form |
| `admin-shell`, `nav-<view>` | Shell and its navigation |
| `policy-screen`, `policy-kind[data-kind]`, `policy-entry`, `policy-add`, `policy-name-input`, `policy-field-<field>`, `policy-form` | Policy screen |
| `skill-browse` | Opens a skill's files (present only on `skill` rows) |
| `skill-files`, `skill-files-empty`, `skill-file-list` | The panel |
| `skill-file[data-path]` | One file; `disabled` when it is not text |
| `skill-editor[data-path]`, `skill-editor-input`, `skill-save`, `skill-saved` | The editor |
| `skill-upload-input`, `skill-upload`, `skill-delete`, `skill-close` | Actions |

`skill-editor[data-path]` exists because the open file must be stated rather
than inferred from what the box happens to contain — otherwise a reader arriving
mid-load, human or automated, can only guess whether the text belongs to the
file the list is highlighting.

## Steps

1. Sign up, then sign in.
2. Open the skills screen. Expect five kinds.
3. Create a `skill` entry named `browser-check` if it does not exist.
4. Open its files. Expect the empty-bundle message.
5. Upload a zip holding `SKILL.md`, `Makefile`, `scripts/run.lua`,
   `references/notes.md`, and `assets/logo.png` (bytes containing NULs).
6. Read the listing.
7. Open `SKILL.md`, compare against what was uploaded.
8. Append a line, save, open another file, come back, and read it again.
9. Through the API, attempt four paths the screen offers no way to type.
10. Reload and check for page errors.

Separately, outside the browser:

11. Write a file into `/skills` from the admin container; read it from
    worker-tool; attempt to overwrite it and to create a new file there.

## Expected results

| Step | Expected |
| --- | --- |
| 2 | Five kind cards: skill, mcp, command, hook, prompt |
| 4 | The panel says the bundle is empty rather than showing an empty list |
| 6 | All five files listed, `SKILL.md` **first** |
| 6 | `Makefile` and `scripts/run.lua` are openable; `assets/logo.png` is listed and disabled |
| 7 | The editor holds exactly the uploaded bytes |
| 8 | The reopened file holds the edit — the save banner is not the evidence |
| 9 | All four refused with 4xx: an edit path leaving the folder, a zip entry that climbs, a zip entry that is absolute, a skill name that is not a folder |
| 10 | No page errors |
| 11 | worker-tool reads the file; both writes fail with `Read-only file system`; the bundle is unchanged |

`SKILL.md` first is a real expectation and not a nicety: the alphabet puts a
`Makefile` ahead of it, which buries the one file every skill has and the one a
person opens.

## Logs to capture

- `deploy-total` and the per-service `deploy-summary` lines.
- Each check with its outcome, and the refusal responses in full — the message
  identifies which of the two defence layers refused, and both are wanted.
- Screenshots at: policy screen, empty bundle, listing, editor open, after save,
  after the refusals.
- Console and page errors for the whole run.
