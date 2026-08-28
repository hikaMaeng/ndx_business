# Storage layout

Everything either service persists lives under one host root, so there is one
folder to copy, back up, or move to another machine.

```
${NDX_DATA_HOST_DIR:-./workspace}/
  <project folders>/          the coding agent's projects, one per folder
  .ndx/
    postgres/                 the standalone pgmq database (the `agent` app)
    admin/
      data/                   files Admin keeps outside the database
      postgres/               the database Admin serves to the coding agent
```

## Why `.ndx` is inside the projects root and not beside it

One root is the point: a single path names the whole of a deployment's state.
The dot keeps it out of the project picker, which already skips directories
whose names begin with `.` (`listWorkspaceFolders`).

## Why it is masked out again for the agent

The picker hides it; a shell does not care. The coding agent runs real `bash`
with the projects root mounted, so `.ndx` would otherwise be one `rm -rf` away
from the database. Every container that mounts the root also mounts an empty
tmpfs over `/workspace/.ndx`, so inside those containers the directory exists,
is writable, and reaches nothing. Verified by writing a file to it from the
worker and confirming the host path stays empty.

Admin and the standalone postgres do *not* get that mask — they are the
services that own the data, and neither runs untrusted commands.

## What this replaced

| Was | Now |
| --- | --- |
| `ndx-business_postgres_data` (named volume) | `.ndx/postgres` |
| `ndx-business_admin_data` (named volume) | `.ndx/admin/data` |
| **an anonymous volume** | `.ndx/admin/postgres` |

The third row was a live defect, not a tidy-up. The database Admin serves —
accounts, the fact log, and every session the coding agent has ever run — sat
on a volume the base postgres image declared with `VOLUME /var/lib/postgresql`
and that nothing named. No compose file mentioned it. `docker compose down`
left it behind as an orphan and the next `up` attached a new empty one, so the
entire history was one ordinary command away from being silently replaced with
nothing.

## Postgres on a Windows bind mount

This works, and was tested before the move rather than assumed: initdb, a
write/read round trip, and the same data still present after the container was
destroyed and recreated against the same host folder. The postgres services
run as `0:0` so the official entrypoint can fix directory permissions first.

Expect the first start on a fresh folder to be slower than a named volume —
initdb writes ~1,500 files across the host bridge.

## Moving or resetting

Set `NDX_DATA_HOST_DIR` to relocate the whole root. `VIBE_WORKSPACE_HOST_DIR`
is still honoured as a fallback so an existing `.env` keeps working.

To reset one service, stop the stack and delete that subfolder — not the root,
which would take the projects with it.
