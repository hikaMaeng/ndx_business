# Skills

## What a skill is

A folder. `SKILL.md` plus whatever it needs beside it — `references/`,
`scripts/`, `assets/`, or nothing at all. The policy entry of kind `skill`
names it and carries the one-line description a session is shown; the folder is
what the session reads when that line turns out to be relevant.

## Uploading and editing

Skills arrive as a zip and are browsed and edited in the admin afterwards. A
second upload **replaces** rather than merges: it is a new version, and leaving
the previous version's files behind produces a bundle matching neither archive.

Every text file opens in the editor. Which files those are is decided by looking
at the bytes, not at the extension — see `admin_domain/docs/api.md` for why.

## Where the files live

| Layer | Path |
| --- | --- |
| Organisation | `<root>/org/<organizationId>/<name>` |
| Project | `<root>/project/<projectId>/<name>` |
| Account | `<root>/account/<ownerId>/<name>` |

Layered because the merge may have to choose between two layers defining one
name. Without the layer in the path the nearer copy would overwrite the further
one's files, and the merge would be choosing between a name and itself.

The admin container mounts this root read-write at `/skills`. The tool container
mounts the same root **read-only** at the same path — outside `/workspace`,
whose `.ndx` is masked there by a tmpfs. Read-only because a skill is policy: an
agent that can rewrite the instructions it was given is not being governed by
them, and the kernel is a better place to say so than a sentence in a prompt.

## How a session uses one

The session is shown a one-line index: each skill's name, its description, and
the path to its folder. The full text is not in the prompt — most turns need
none of them, and a page of instructions for a skill nobody reaches for competes
for attention with the conversation.

When a skill covers the task, the agent reads its `SKILL.md`. That file is the
whole contract, including how to run anything the skill ships.

**Nothing here names an interpreter.** What a skill is made of, and how it is
run, is the skill's own business — a shell script, a Rust binary, a Makefile
target, a Python module. A convention stated in the base prompt would be a
second answer competing with `SKILL.md`'s, and the prompt is the one that goes
out of date. It also could not be right: zip does not preserve the executable
bit, so the run command cannot be inferred from the file either.

Two things do hold for every skill, which is what lets a `SKILL.md` be written
as though its skill were the only thing that existed:

- **The working directory is the project, not the skill.** A relative path in a
  command means somewhere in the project. The skill's own files are reached
  through the path in the index.
- **The skill's folder is read-only.** Output goes in the project.

## Layers

An entry belongs to exactly one layer, and the layer decides both where it is
stored and who may edit it.

| Layer | Who may edit | May enforce |
| --- | --- | --- |
| Organisation | anyone who may manage that organisation | yes |
| Project | the account that owns the project | no |
| Account | the account itself | no |

The chips on the screen are derived from the same permission the routes enforce
— `canUpdate`, which is projected from `canManage`. Deriving them from anything
else produces a chip that saves and is then refused, which looks like it worked.

**Enforcement is absent, not disabled, on the personal layers.** Only an
organisation can bind those beneath it, so on an account layer the checkbox
would be a question with one answer.

## MCP

MCP servers are policy entries of kind `mcp`, and a skill declares which it
needs in its own `mcp` field. The binding is the skill's: a skill says what it
needs, and the deployment says what those are. An MCP entry nothing declares is
configured and unreachable, which is a fine thing to be.

### Transports

An MCP server is reached over stdio or over SSE, and the two share nothing but a
description.

| Transport | Fields |
| --- | --- |
| `stdio` | `command`, `args`, `env` |
| `sse` | `url`, `headers` |

Declared in `POLICY_VARIANTS`, so a third transport needs no new form — the same
way a sixth kind needs no new screen. The form keeps every field in the draft
while it is open, so looking at the other transport does not discard what was
typed, and sends only the fields on screen: a command left over from a glance at
stdio is not part of an SSE server, and storing it would make one entry describe
two things.

An SSE URL must be `https`, except on localhost. An MCP server is handed
whatever the session can reach, and sending that over plain http is not a
decision to make by leaving a field the way it was typed.

An entry with no command, or no URL, is **refused rather than defaulted**. It is
not a server waiting on something else; it is one somebody stopped halfway
through, and a plausible default moves the failure to the point of connection,
where the reason is gone.

### Why they are not in the prompt

The session is shown skills. An MCP server listed beside the skill that wraps it
would show one capability under two names, and the choice between them is a
choice with no right answer.

There is a second reason, and it would be enough on its own: a server can be
reconfigured while a session runs, and anything mutable in the prefix costs the
provider's cache for the whole transcript.

So the bound servers are stored in `vibe_session.mcp_servers`, written in the
same statement as the prompt and under the same once-only guard. The tool side
reads them when a skill asks; the model never sees them.

What could not be bound is recorded in the session's recipe with a reason —
`unknown`, `disabled`, or `unusable`. All three look identical from the
outside ("the skill did nothing"), and one skill's broken binding does not stop
a session from opening with the others.

### Not yet connected

Entries are validated, bound, and stored where the tool side can read them. The
stdio process and the SSE client are not written. A skill naming a server today
gets a correct answer to "which server" and no connection.
