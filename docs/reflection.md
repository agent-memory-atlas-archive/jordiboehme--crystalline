# The Reflection

A domain can keep a Reflection: documents for people, next to the engrams the agent keeps. This page explains how it works, who may do what, where it lives on a team and how an agent works on it every day.

## What a Reflection is

A Reflection is a domain's documents for people. They live in the folder `reflections/` of the domain, and each one is called a reflection. They are written at the level that `reflections/PACT.md` agrees on: for whom, how deep and in which structure.

Engrams stay the agent's knowledge. The Reflection is where people and agents meet. Both edit the pages, and both comment on them in threads. The agent brings what changed in the engrams into the pages, and it reads what people changed in the pages and decides what to learn from it.

A reflection is not an engram. It needs no frontmatter, `search_engrams` never returns it, and with the switch on the engram tools (`write_engram`, `edit_engram`, `move_engram`, `delete_engram`) refuse paths under `reflections/`. Four tools work on it instead: `reflect`, `read_reflection`, `write_reflection` and `discuss`. The Fluid pages for the Reflection follow in 0.27.0. Until then people reach it through their agent, the files on disk and the JSON API.

## Switch it on

Set the MANIFEST key `reflection: on`. Do it in the domain policies card in Fluid, with `PATCH /api/v1/domains/{domain}/manifest`, or ask your agent (the `configure` tool with `domain`). Switching it on writes a first `reflections/PACT.md` with the three headings to fill in. Switching it off again is always allowed, and the files stay where they are.

Switching it on is refused in these cases, and the refusal says why:

- Engrams already live in `reflections/`. The refusal names them. Move them to another folder first (`move_engram`), then switch it on.
- The domain is virtual. A Reflection needs a domain kept as files.
- The domain is connected to GitHub and this instance has no `service.public_url`. A shared domain's Reflection has one home, and the home needs an address (see [One home, one backup](#one-home-one-backup)).
- The domain is connected to GitHub and the team's copy still holds files in `reflections/`. Share the change that moves them out first.
- The domain has two folders that differ only in letter case, for example `reflections/` and `Reflections/`.

A plain editor or a pull can still write `reflection: on` into the MANIFEST. If engrams still live in `reflections/` then, the switch is pending: the folder stays engram content until the last engram has left it, and the Reflection tools answer that they wait for that. A `reflect` call over all domains names such a domain under `scope.pending`.

## The pact

`reflections/PACT.md` is the agreement between the people and the agents who work on the Reflection. It has three parts:

- `## Audience`: who reads these pages and what they already know.
- `## Level of detail`: how deep the pages go, and what they leave to the engrams.
- `## Structure`: one bullet per glob, for example `- guides/*.md`.

The agent reads the pact before it writes. A page that fits none of the `## Structure` globs is reported to the agent as an update item. A change to the pact is reported too, so the agent applies it to the pages it affects.

## Sections and their hidden ids

Every `##` heading of a reflection gets a hidden id on the next line, for example `<!-- r:7f3a9c2e -->`. The id ties a section to its threads and to the engrams it was built from, so a section keeps them when its heading changes. Leave the line alone. A heading added in another editor gets its id on the next write through Crystalline.

The frontmatter block `reflection:` is Crystalline's own. For each section it records the engrams the section was built from (with their checksum at that time), a hash of the text at the last reflect, and who changed the text since then. A person who cannot read the engrams gets the page without this block, so engram names stay hidden from them. Do not edit the block by hand.

An agent can write a whole page or one section. `write_reflection` takes the same three section operations `edit_engram` takes: `replace_section`, `insert_before_section` and `insert_after_section`, with the section named by its heading. The section keeps its id. A `crystalline://` address in a page is spelled with the domain's current name on every write, as in an engram, and renaming a domain also respells its Reflection pages.

## Threads

A thread is a discussion about one passage. It is anchored on a section and, if you like, on an exact quoted passage in it. A thread can be opened, answered, resolved with a short outcome and reopened. The threads of a page are stored in `<name>.threads.md` beside the page. The history of a thread is only ever added to: a resolved thread does not change, and a reopen is a new entry.

Agents write each comment as a conventional comment: a first line `<label> [decorations]: <subject>`, for example `question (non-blocking): is this still true after the migration?`. An agent never puts engram links into a thread, because some readers cannot see engrams.

## Who may do what

Access has two axes. They are set side by side: per account for every shared domain, and per member on a private domain.

- The knowledge level decides what someone may do with the engrams: `none` (sees no engram), `viewer`, `editor`, and on a private domain `manager`, on the instance `admin`.
- The Reflection level decides what someone may do with the Reflection: `reader` reads and comments, `contributor` also edits. It only raises what the knowledge level already gives. Without one, the knowledge level decides.

| Knowledge level | Reflection, no level set | with `reader` | with `contributor` |
|---|---|---|---|
| `admin`, `manager`, `editor`, the domain owner, the machine owner | curate | curate | curate |
| `viewer` | read and comment | read and comment | edit |
| `none` | nothing | read and comment | edit |
| anonymous visitor, public domain | read, never comment | - | - |

- **Read and comment** means reading every page, its threads and its files, and taking part in threads.
- **Edit** adds writing pages: create, change, move and delete them, and add new files.
- **Curate** adds writing `PACT.md`, recording the engrams a section was built from, settling feedback, and replacing, moving and removing files. Everyone who may edit the engrams curates. Readers and contributors propose a pact change in a thread.
- A member of a private domain at knowledge `none` needs a Reflection level; without one the membership grants nothing and is refused.
- An account whose write list leaves a domain out only reads and comments there, whatever its levels say.
- An anonymous visitor reads a public domain's Reflection and never comments.

The commands:

```bash
# an account that works on the Reflection of every shared domain without seeing engrams
crystalline users add ada --role none --reflection contributor
# change an account's Reflection level: default, reader or contributor
crystalline users reflection ada reader
# a member of a private domain who reads its Reflection only
crystalline domain members eng add ada --level none --reflection reader
```

## The reflect queue

`reflect` hands an agent the Reflection's work queue. It is computed fresh on every call and changes nothing. There are three kinds of item.

| Kind | `what` | Meaning |
|---|---|---|
| feedback | `new`, `changed`, `removed` | A person added, changed or removed a section since the last reflect. The item carries the diff, who changed it and the engrams the section was built from. |
| update | `source_changed` | An engram a section was built from changed. |
| update | `source_retired` | An engram a section was built from was retired. |
| update | `source_missing` | An engram a section was built from is gone. |
| update | `unreflected` | An engram no section covers yet. |
| update | `off_structure` | A page fits none of the pact's `## Structure` globs. |
| update | `pact_changed` | The pact changed since the pages were last brought in line with it. |
| update | `asset_missing` | A page links a file in `reflections/assets/` that is not there. |
| update | `engram_attachment` | A page embeds an engram attachment instead of a file of its own. |
| update | `asset_unreferenced` | A file in `reflections/assets/` that no page links. |
| review | `thread` | A thread waits for the agent. |

Items about the same section stay together. Groups come oldest first, and inside a group feedback comes before update and update before review. So the agent reads a person's change before it rewrites the section.

The agent settles a feedback item in one of three ways:

- It takes the change into the engrams: it changes the engrams, then writes the section with its source engrams.
- It keeps the change as the person's text (`write_reflection` with `action: settle` and `outcome: kept`).
- It answers in a thread (`discuss` with `answers_feedback`), when it disagrees or has a question.

Three nudges point the agent at open items of the Reflections its user curates: the receipt of a write, the reminder at the end of a session (the Stop hook) and the line for the domain in the routing block at session start ("Reflection: 3 open items - call reflect"). The daemon counts the open items every five minutes.

On a machine connected to a server with `crystalline connect`, the server's domains appear under their names on this machine. The agent works their Reflections through the same four tools, with its user's rights on that server. A queue over all domains asks every server. The nudges for these domains come from the server's counts, which the daemon fetches every three minutes.

## Searching a Reflection

`search_engrams` leaves Reflection pages out. To search them, call `read_reflection` with `query`. The search finds sections, not whole pages.

- `search_type` is `hybrid` (the default), `text` or `semantic`. Hybrid and semantic search answer as text search when there is no embedding model, when no page is embedded by the active model yet, or when the stored vectors belong to another model. The answer's `mode` says which search ran.
- `limit` is 10 by default and at most 100. `page` pages through the hits.
- `path` and `query` together are refused: pass `path` to read one page, or `query` to search them all.
- Each hit names the page, its title, the section id and heading, and a short snippet. A hit never carries a score.

The JSON API searches the same way: `GET /api/v1/domains/{domain}/reflection/search` takes `q`, `search_type`, `limit` (20 by default, at most 100) and `page`.

The sections of each page are cut into chunks and embedded beside the engrams, in a table of their own. A write wakes the embedding worker, so a new page can be found by meaning soon after. `crystalline status` and `crystalline doctor` count the reflection chunks while there are any. When the index is upgraded, every page is read and chunked again once, on the first start; `crystalline reindex --full` does the same.

## Files in a Reflection

A page can show images and other files. They live in `reflections/assets/`, for example `reflections/assets/diagrams/flow.png`. The rules for what may be stored are the ones for engram attachments: the same file types and the same size limit.

A page links a file relative to its own folder. A page in `reflections/` writes `![Flow](assets/diagrams/flow.png)`, and a page in `reflections/guides/` writes `![Flow](../assets/diagrams/flow.png)`. A link may carry the same formatting fragment as an image on an engram, for example `#right,w=50%`.

A page may not embed an engram attachment from the domain's own `assets/` folder. Copy the file into `reflections/assets/` first and link the copy. A write through Crystalline that embeds an engram attachment is refused, and `reflect` reports one that came in another way.

The Reflection's rights decide, and the knowledge rights play no part:

- A reader reads every file.
- A contributor adds a new file.
- A curator replaces, moves and removes files. A move rewrites every link to the file.

These files are not engram attachments. The engram sweep never reports them as orphans. `reflect` reports a file no page links and a link to a file that is missing. The backup branch and the domain export carry them.

## One home, one backup

A local domain keeps its Reflection where it is, in its folder.

A domain shared through GitHub has one home: the instance whose `service.public_url` is the domain's `reflection_home`. This key is filled in when Reflection is switched on at that instance, and it is never set by hand. Every other instance answers "this domain's Reflection lives at <url>". People and agents work on the Reflection at the home.

The home backs the whole `reflections/` folder up to the branch `crystalline/reflections` of the domain's repository, with its own GitHub token:

- At once after an agent's write, a comment, a settle, a move or a delete, and when a co-editing session closes.
- After one minute without a new edit, for a person's edits in a co-editing session or a change on disk.

The branch starts empty and never carries an engram. "Share changes" never offers a file under `reflections/`. A change marked while the daemon restarts is committed with the next one. A failed backup is tried again later, with a growing wait up to one hour.

To move the home to a new `service.public_url` or to another server, copy the `reflections/` folder there first (the restore steps below work for that too). Then switch Reflection off and on again at the new home. That fills in `reflection_home` again.

## Restore from the backup

1. Stop the daemon.
2. Download the branch: `git clone --branch crystalline/reflections --single-branch <repo> /tmp/reflection-backup`, or use the forge's "Download ZIP" for that branch.
3. Copy its `reflections/` folder over the domain's `reflections/` folder. The copy includes the hidden folder `.reflected/` (the text at the last reflect), the threads and `PACT.md`.
4. Start the daemon.
5. Run `crystalline reindex` to bring the reflection index back.

The next backup commits whatever differs from the head of the branch. Files deleted locally while the backup state was lost may stay on the branch until such a restore.

A domain export (the archive download in Fluid or `crystalline domain export`) also carries the Reflection while the switch is on: its pages, threads, files and the hidden baseline in `.reflected/`. An import leaves `reflections/` out where a Reflection keeps that folder, because its pages are not engrams. Restore a Reflection from its backup branch as above.

## A scheduled run

A daily headless agent on the home instance can work the queue. Two examples, both plain text to adapt to your setup.

```bash
# cron, daily at 06:30, as the account that runs the daemon
30 6 * * * cd /srv/kb && claude -p "Call the crystalline reflect tool for the domain eng and work the queue: feedback items first, then update items, then answer review threads in plain words. Stop when the queue is empty or after 20 items." >> /var/log/crystalline-reflect.log 2>&1
```

```ini
# systemd: /etc/systemd/system/crystalline-reflect.service and .timer
[Unit]
Description=Work the Reflection queue of eng

[Service]
Type=oneshot
User=crystalline
WorkingDirectory=/srv/kb
ExecStart=/usr/local/bin/claude -p "Call the crystalline reflect tool for the domain eng and work the queue: feedback items first, then update items, then answer review threads in plain words. Stop when the queue is empty or after 20 items."

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

The agent needs the crystalline MCP server registered for that account (`crystalline install`). When the instance asks agents to authenticate, it also needs an account with curate access, through an MCP token in the harness config of that account. `crystalline install` does not set up the scheduled run in this release.
