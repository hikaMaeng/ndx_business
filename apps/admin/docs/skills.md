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

## MCP

MCP servers are configured as policy entries of kind `mcp`, and a skill binds
the ones it needs. They stay out of the session context: an MCP server listed
beside the skill that wraps it would show one capability under two names, and
the choice between them is a choice with no right answer.
