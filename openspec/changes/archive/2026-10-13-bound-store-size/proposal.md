## Why

Every session's list and trash live in one `$.store` JSON file, which Claude Code caps at 4,194,304 characters in all, and the mod keeps an entry for as long as `cleanupPeriodDays` allows. With a long setting (720 days here) and the trash keeping entries alive, the store reaches the cap long before anything expires; past it, every write fails silently and a resumed session comes back with an old list. The startup sweep also reads the whole file once per saved session, so its cost grows with the square of the store's size (about 140 s near the cap, measured in Node).

## What Changes

- Each session's entry is saved under a key that carries its update time and size, so the mod can see every entry's age and size from the key names alone.
- The startup sweep reads only the key names: it expires entries by `cleanupPeriodDays` as before, and when the store is over 80% of the cap it drops whole sessions, oldest update first, until it is at or under 80%. The current session is never dropped.
- A write the cap refuses frees room the same way and is tried once more.
- A write that still fails shows a toast once per session saying list changes are not being saved. `/todos refresh` no longer reports the list as unchanged when it did change.
- Entries saved under the old key format are moved to the new one the first time a session starts.
- **BREAKING**: An older version looks for the old key and finds nothing, so after a downgrade lists look empty. They are not deleted, and upgrading again brings them back. It ships as a minor version bump.

## Capabilities

### New Capabilities

- `saved-list-storage`: How each session's list and trash are saved and found again, when saved entries expire or are dropped to stay under the store's cap, and what the user is told when a save fails.

### Modified Capabilities

None. The existing specs (`item-trash`, `stale-item-review`) do not cover how entries are saved.

## Impact

- `hooks/store.ts` (new): store keys, the cap and target, the size computation, and the choice of sessions to drop.
- `hooks/register.tsx`: `persist` and its callers' error handling, the `session.start` sweep and restore, and `/clear` in `session.end`.
- `tests/todo-list.test.ts`: tests for the key format, restore, expiry, size-based dropping, the retry, the toast, migration, and `/clear`.
- `README.md`, `README.zh-TW.md`: How It Works, on how long a saved list is kept.
- `.claude-plugin/plugin.json`: minor version bump at release, shared with `paginate-todo-band` when both ship together.
