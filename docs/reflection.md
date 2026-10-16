# The Reflection

A domain can keep a Reflection: documents for people, next to the engrams the agent keeps. This page explains how it works, who may do what, where it lives on a team and how an agent works on it every day.

## What a Reflection is

A Reflection is a domain's documents for people. They live in the folder `reflections/` of the domain, and each one is called a reflection. They are written at the level that `reflections/PACT.md` agrees on: for whom, how deep and in which structure.

Engrams stay the agent's knowledge. The Reflection is where people and agents meet. Both edit the pages, and both comment on them in threads. The agent brings what changed in the engrams into the pages, and it reads what people changed in the pages and decides what to learn from it.

A reflection is not an engram. It needs no frontmatter, `search_engrams` never returns it, and with the switch on the engram tools (`write_engram`, `edit_engram`, `move_engram`, `delete_engram`) refuse paths under `reflections/`. Four tools work on it instead: `reflect`, `read_reflection`, `write_reflection` and `discuss`. The Fluid pages for the Reflection follow in 0.27.0. Until then people reach it through their agent, the files on disk and the JSON API.

## Switch it on

Set the MANIFEST key `reflection: on`. Do it in the domain policies card in Fluid, with `PATCH /api/v1/domains/{domain}/manifest`, or ask your agent (the `configure` tool with `domain`). Switching it on writes a first `reflections/PACT.md` with the three headings to fill in. Switching it off again is always allowed, and the files stay where they are.

On a domain connected to GitHub, switching it off has one more effect. The folder `reflections/` is then ordinary engram content, so "share changes" offers its pages, their threads and `PACT.md`. Threads can hold comments from people who may not see engrams. So do not share changes while the switch is off. Once these files are in the team's copy, switching on again is refused until the team's copy no longer holds them. The answer to the switch-off says this too.

If a page is moved while somebody has it open, Crystalline saves the page first, closes the editor and tells it the new path; the editor then offers to open the page there, with any text not saved yet. A rename of the domain does the same for every open page. If the Reflection is switched off while a page is open, Crystalline saves the page first and closes the editor. If the switch changes outside Crystalline (a plain editor, a pull), a page that is still open cannot be saved: the editor keeps its text, and when the last person leaves, the server keeps it in its state folder. `crystalline kept list` shows it and `crystalline kept show <id>` prints it, so you can copy it back (see [Kept texts](teams.md#kept-texts)).

Switching it on is refused in these cases, and the refusal says why:

- Engrams already live in `reflections/`. The refusal names them. Move them to another folder first (`move_engram`), then switch it on.
- The domain is virtual. A Reflection needs a domain kept as files.
- The domain is connected to GitHub and this instance has no `service.public_url`. A shared domain's Reflection has one home, and the home needs an address (see [One home, one backup](#one-home-one-backup)).
- The domain is connected to GitHub and the team's copy still holds files in `reflections/`. Share the change that moves them out first.
- The domain has two folders that differ only in letter case, for example `reflections/` and `Reflections/`.
- The domain is connected to GitHub and the record of the team's copy cannot be read. Repair or remove that record; the next pull writes it again.
- This instance's `service.public_url` cannot be a Reflection's home, for example because it is not a valid address for that.

A plain editor or a pull can still write `reflection: on` into the MANIFEST. If engrams still live in `reflections/` then, the switch is pending: the folder stays engram content until the last engram has left it, and the Reflection tools answer that they wait for that. A `reflect` call over all domains names such a domain under `scope.pending`. A page written by hand with no hidden section id counts as such an engram too (see the next sections). Two folders that differ only in letter case keep the switch pending the same way, until one of them is gone. So does an engram whose frontmatter no longer parses, or that an editor saved in another encoding than UTF-8: Crystalline still holds its last good version, so fix the file, then move it out. A file in the folder that never was an engram does not hold the switch. When the switch takes effect, however it got there (the domain policies, a plain editor, a pull, or the last engram leaving the folder), Crystalline reads the whole domain again at once: every page in `reflections/` leaves the engram index, and the Reflection lists all pages, their threads and files. Switching it off works the same way the other direction.

## The pact

`reflections/PACT.md` is the agreement between the people and the agents who work on the Reflection. It has three parts:

- `## Audience`: who reads these pages and what they already know.
- `## Level of detail`: how deep the pages go, and what they leave to the engrams.
- `## Structure`: one bullet per glob, for example `- guides/*.md`.

The agent reads the pact before it writes. A page that fits none of the `## Structure` globs is reported to the agent as an update item. A change to the pact is reported too, so the agent applies it to the pages it affects.

## Sections and their hidden ids

Every `##` heading of a reflection gets a hidden id on the next line, for example `<!-- r:7f3a9c2e -->`. The id ties a section to its threads and to the engrams it was built from, so a section keeps them when its heading changes. Leave the line alone. A heading added in another editor gets its id on the next write through Crystalline.

The id lines also mark a file as a page. Give every page at least one `##` heading, and put an id line under it. A page written through Crystalline gets its id lines, but only under `##` headings, so a page without one has none. For an id you write by hand, use 4 to 16 lowercase hex digits that start with a letter, for example `<!-- r:c3d4e5f6 -->` (an id like `1234e567` can be read as a number). A file with no id line, no `reflection:` block in its frontmatter and no copy in the hidden folder `.reflected/` reads as an engram when Crystalline looks at the folder from scratch: when Reflection is switched on, after a rebuild such as `crystalline reindex --full`, and on the first sync of a new machine. The Reflection then waits until the file is moved out or marked.

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
- An account whose write list leaves a domain out at most reads and comments there, whatever its levels say. The list never grants access.
- An anonymous visitor reads a public domain's Reflection and never comments.
- A version before 0.26.0 does not know the knowledge level `none` and reads it as `viewer`. So before you go back to an older version, give those accounts and members a level that is right for the older version.

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
| update | `host_moved` | The domain moved to this instance on a shared database, and this disk lacks files the previous host wrote. One item per domain, with the counts in `only_elsewhere`. See [One home, one backup](#one-home-one-backup). |
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

- `search_type` is `hybrid` (the default), `text` or `semantic`. Hybrid and semantic search answer as text search when there is no embedding model, when no page of this domain is embedded by the active model yet (another domain's vectors do not count), or when this domain's stored vectors belong to another model. The answer's `mode` says which search ran.
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
- A curator replaces, moves and removes files. A move rewrites every link to the file. A move keeps the file's extension, and a change of letter case alone (`a.png` to `A.png`) is a plain rename. A change only in Unicode normal form may be refused as a move onto an existing file.

These files are not engram attachments. The engram sweep never reports them as orphans. `reflect` reports a file no page links and a link to a file that is missing. The backup branch and the domain export carry them.

## One home, one backup

A local domain keeps its Reflection where it is, in its folder.

A domain shared through GitHub has one home: the instance whose `service.public_url` is the domain's `reflection_home`. This key is filled in when Reflection is switched on at that instance, and it is never set by hand. Every other instance answers `this domain's Reflection lives at <url>`. People and agents work on the Reflection at the home.

Several instances can share one Postgres database (see [Shared database collaboration](deployment.md#shared-database-collaboration)). Then one instance serves a domain's Reflection: the one that holds the domain's host lock, which also syncs the domain's files. Every other instance answers `this domain's Reflection is served by <label>; move it with crystalline serve --take-over`, and its status says `hosted_elsewhere` and names the host: the host of its `service.public_url`, else its machine's hostname. `crystalline serve --take-over` on another instance moves the lock and the Reflection there. The new host serves at once, and the old one refuses from its next request. When the host shuts down cleanly, the next instance that is asked for the Reflection takes the lock and serves it. When the host crashed or went to sleep, the next write to the Reflection takes the lock once the old host's last heartbeat is 90 seconds old; a read only names the old host and says when it was last seen. A person who is not signed in sees `another instance` instead of the host's name. A command that runs without a daemon never takes the lock for that: it answers that the Reflection is not served by a command and that you start the daemon. It serves the Reflection only while this machine already holds the lock, through its daemon, a `crystalline mcp --embedded` session or another command. For a domain shared through GitHub, the host also needs to be the `reflection_home`.

Each instance keeps the Reflection's files on its own disk: the pages, the threads, the hidden baselines and the files under `reflections/assets/`. The files on disk are the truth, so when the Reflection moves to another instance, copy the domain folder to the new host, or keep it on a volume both instances share. For a domain shared through GitHub, the Reflection can also come back from the `crystalline/reflections` branch (see [Restore from the backup](#restore-from-the-backup)). A new host never writes a page from the database to its disk, and never deletes the row of a page it does not have. It keeps those rows, its queue shows one `host_moved` item with the counts, and it does not back up the Reflection. While the item is open, a write that would create one of those pages, files or engrams on this disk is refused with the same remedy (409 over the JSON API): a whole-page write, a page move onto its path, an upload to its path, a file move onto it, an overwriting capture of an engram and an engram move onto its path. An edit or a delete of such a file or engram is refused too, because its row is the only shared copy. A row this instance wrote after the move, whose file was then deleted by hand, is refused the same way until the move is resolved. Pages without their baseline raise no feedback while the item is open. The item goes away when a sync finds every file, or when a person runs `crystalline sync --domain <name> --accept-disk` after the item appeared, which deletes the rows of the files that are still missing.

The home backs the whole `reflections/` folder up to the branch `crystalline/reflections` of the domain's repository, with its own GitHub token:

- At once after an agent's write, a comment, a settle, a move or a delete, and when a co-editing session closes.
- After one minute without a new edit, for a person's edits in a co-editing session or a change on disk.

The branch starts empty and never carries an engram. "Share changes" never offers a file under `reflections/`. A change marked while the daemon restarts is committed with the next one. A failed backup is tried again later, with a growing wait up to one hour.

To move the home to a new `service.public_url` or to another server, copy the `reflections/` folder there first (the restore steps below work for that too). Then switch Reflection off and on again at the new home, in one go. That fills in `reflection_home` again. Do not share changes between the two steps: while the switch is off, "share changes" offers the files in `reflections/` as engram changes. Share the MANIFEST change at once after the switch-on. Until the old home pulls it, both instances act as the home and back up to the same branch. The old home stops when it pulls the change.

## Restore from the backup

1. Stop the daemon.
2. Download the branch: `git clone --branch crystalline/reflections --single-branch <repo> /tmp/reflection-backup`, or use the forge's "Download ZIP" for that branch.
3. Copy its `reflections/` folder over the domain's `reflections/` folder. The copy includes the hidden folder `.reflected/` (the text at the last reflect), the threads and `PACT.md`.
4. Start the daemon.
5. Run `crystalline reindex` to bring the reflection index back.

The next backup commits whatever differs from the head of the branch. Files deleted locally while the backup state was lost may stay on the branch until such a restore.

A domain export (the archive download in Fluid or `crystalline domain export`) also carries the Reflection while the switch is on: its pages, threads, files and the hidden baseline in `.reflected/`. An import leaves `reflections/` out where a Reflection keeps that folder, because its pages are not engrams. Restore a Reflection from its backup branch as above.

## A scheduled run

A daily headless agent on the home instance can work the queue. The examples below are plain text to adapt to your setup. They pass `--allowedTools "mcp__crystalline"`, because a headless run has nobody to approve a tool call: without it every crystalline tool call is refused and the run does nothing.

Cron, daily at 06:30, as the account that runs the daemon:

```bash
30 6 * * * cd /srv/kb && /usr/local/bin/claude -p "Call the crystalline reflect tool for the domain eng and work the queue: feedback items first, then update items, then answer review threads in plain words. Stop when the queue is empty or after 20 items." --allowedTools "mcp__crystalline" >> /var/log/crystalline-reflect.log 2>&1
```

With systemd, use two files. `/etc/systemd/system/crystalline-reflect.service`:

```ini
[Unit]
Description=Work the Reflection queue of eng

[Service]
Type=oneshot
User=crystalline
WorkingDirectory=/srv/kb
ExecStart=/usr/local/bin/claude -p "Call the crystalline reflect tool for the domain eng and work the queue: feedback items first, then update items, then answer review threads in plain words. Stop when the queue is empty or after 20 items." --allowedTools "mcp__crystalline"
```

`/etc/systemd/system/crystalline-reflect.timer`:

```ini
[Unit]
Description=Work the Reflection queue of eng every day

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer with `systemctl enable --now crystalline-reflect.timer`.

The agent needs the crystalline MCP server registered for that account (`crystalline install`). When the instance asks agents to authenticate, it also needs an account with curate access, through an MCP token in the harness config of that account. `crystalline install` does not set up the scheduled run in this release.
