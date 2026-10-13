## Context

See proposal.md (Why) for the motivation and specs/saved-list-storage/spec.md for the behavior. Today `persist()` in `hooks/register.tsx` writes `{ items, trash, updatedAt }` under `session:<id>`, or deletes the key when both lists are empty. `session.start` runs `keys()` and then `get()` on every key to expire old entries, then restores its own. `$.store` is one JSON file per plugin: `get` and `keys` read and parse the whole file, `set` and `delete` lock it, read it, and rewrite it, and `set` rejects when the whole store as JSON text would pass 4,194,304 characters. Measured in Node, one `set` costs about 24 ms at 1.2M characters and 82 ms at 4.1M. A failed `persist()` throws into its caller after `$.state` has already changed: the per-turn update swallows it, and `/todos refresh` reports the list unchanged.

## Goals / Non-Goals

**Goals:**

- Session start costs a fixed number of whole-file reads, whatever the number of saved sessions, apart from the one-time migration.
- The mod knows the store's size without reading values, and stays under the cap without relying on the engine's refusal.
- No two processes write the same key, so concurrent sessions cannot lose each other's saves.

**Non-Goals:**

- Shrinking entries: the detail cap stays at 1,000 characters and the trash caps are unchanged.
- An index key, or moving entries out of `$.store` into files.
- Saving more often or less often than today.

## Decisions

### Store Arithmetic Lives in Its Own Module

Key building and parsing, the cap and target constants, the size computation, and the choice of sessions to drop live in `hooks/store.ts` as pure functions, so tests import them directly and `hooks/list.ts` stays with prompts and the band's window arithmetic.

### Metadata Lives in the Key Name

The key `session:<id>:<updatedAt>:<size>` lets one `keys()` call show every entry's age and size. Session ids are UUIDs and hold no colon, but parsing takes the last two segments as the numbers so an id is never split. Alternative: a single `index` key mapping ids to `{ updatedAt, size }`. Rejected because every save would read, change, and rewrite one shared key from many processes, and `$.store` has no compare-and-set, so concurrent saves would lose index entries. With metadata in key names each process writes only its own session's keys, and the store's own lock orders those writes.

### A Save Is Set Then Delete, Serialized per Process

A save writes the new key, then deletes the key it replaces, which the mod tracks in a `$.state` atom so it survives a hot reload without an extra `keys()` read. The atom is swapped inside one `update` callback rather than read and then written, because a `read` is a snapshot taken when the dispatch began, and two commands saving at once could each delete a stale key and leave the newest one orphaned. Writing first means a crash between the two steps leaves two keys for one session rather than none, and the next start keeps the newer one. Saves in one process go through their own promise chain, separate from `enqueue`, because `commit` already runs inside queued jobs and the restore and purge commands call `persist()` outside the queue; two interleaved saves could otherwise delete each other's new key. An empty list and trash still delete the session's keys instead of saving.

### Size Is Computed the Way the Engine Measures It

The engine compares the length of `JSON.stringify` of the whole store object to the cap. From the key names, that length is `2 + Σ(JSON.stringify(key).length + 1 + size) + (count - 1)`, where `size` is `JSON.stringify(value).length` recorded at save time. That the engine uses plain `JSON.stringify` is read from the shipped bundle, not from the typings, which say only "4 MiB of JSON text in all"; the 20% headroom and the retry below absorb a small difference. The cap itself, 4,194,304, is the typings' 4 MiB. The store holds no keys other than session keys, so the computation counts only parsed session keys; a key of another shape would go uncounted, and the headroom and the retry would absorb it.

### Sessions Are Dropped Whole, Oldest First, at 80%

Over 80% of the cap, the sweep deletes whole sessions in order of `updatedAt`, skipping the current session, until the total is at or under 80%. Dropping a session's trash first was considered and rejected: on current data the trash is about half of a session that has one, so it postpones the drop rather than replacing it, and it erases never-add-back blocks the user set. 80% was chosen over 90% for headroom: 840K characters holds about two and a half full sessions, so the over-the-cap retry, which depends on the engine's error text, should rarely run. It costs about a tenth of the retention, roughly 86 to 190 days at current rates instead of 97 to 213.

### The Over-the-Cap Retry Matches the Engine's Error Text

`set` rejects with a message naming the limit (`over the 4194304 limit`). The mod treats a rejection whose text names the limit as a size refusal: it runs `keys()`, drops sessions as the sweep does, and tries once more. Any other rejection, such as a lock that could not be taken, is not retried. If the engine's wording changes, a size refusal falls through to the failure report instead of being retried, which is why the headroom matters.

### `persist()` Reports Its Own Failure and Does Not Throw

On a final failure `persist()` logs it, shows one toast per session (a flag in `$.state`, so a hot reload does not repeat it), and returns normally. Callers then behave as when the save succeeds: the band keeps the new list, and `/todos refresh` reports the list it applied. Alternative: let each caller handle the error. Rejected because the callers (the per-turn update, the review, refresh, the band's delete, and the `/todos` subcommands) can do nothing about a failed save beyond telling the user.

### Legacy Entries Migrate at Session Start

A key that is exactly `session:<id>` is legacy. The sweep reads each one once, rewrites a valid entry under the new format with its stored `updatedAt`, and deletes the legacy key; an invalid value is deleted. When a session has both a legacy key and new keys, which happens after a downgrade and re-upgrade, the newest `updatedAt` wins. An expired legacy entry, or one no newer than a new key of its session, is deleted instead of migrated. A migration whose save still fails leaves the legacy key in place for the next start. A size refusal during migration frees room as a save does, sparing the current session rather than the one being migrated. This is the only time the sweep reads values, and its cost falls once per legacy entry.

## Risks / Trade-offs

- [A live session other than the current one is dropped] → Only the oldest `updatedAt` goes, and an active session saves often. A dropped live session saves itself again on its next change: its delete of the old key finds nothing, and the next sweep counts the new key.
- [The same session open in two processes] → Each writes its own new key and deletes only the key it wrote last, so the session holds at most one key per process; the next start keeps the newest, as today's last-writer-wins.
- [Each save writes twice] → About 135 ms per save at 80%, by the Node measurements, on saves that change the list; most turns change nothing and do not save.
- [The engine's size measure or error text changes] → The 20% headroom covers a small measure difference; a changed error text turns a would-be retry into the reported failure.
- [Downgrade] → Accepted: an older version looks up `session:<id>`, finds nothing, and shows an empty list. Its own sweep keeps the new keys, since it reads their values as valid entries, so upgrading again restores them.

## Migration Plan

The first session start of the new version migrates every legacy key, then sweeps. The release bumps the minor version, shared with `paginate-todo-band` if both ship together. Rolling back leaves the new keys in place and unread by the older version until the next upgrade.
