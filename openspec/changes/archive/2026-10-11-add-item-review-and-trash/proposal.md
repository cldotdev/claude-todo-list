## Why

The per-turn update removes an item only when one turn resolves it, and it sees only the current list, the previous final answer, this turn's user message, and this turn's final answer. An item made moot by a later decision, or closed by work that shows up only in tool results or subagent reports, never gets a resolving turn, so it stays on the list until the user deletes it or runs `/todos refresh`. A long session (dev:cleanbot-spec:#tabla) showed this: `/todos refresh` cut the list down to the 4 items named in the session's last answer. Refresh, in turn, rewrites the list from scratch, so it can also drop items that are still open, and nothing records what it dropped.

## What Changes

- A periodic review, run on Sonnet, looks back over the turns since the last review and removes items that are no longer open. It never adds items.
- Every item that leaves the list goes to a trash, with the item's title and detail, who removed it (`user` or `model`), and when. The trash replaces the stored `done` list.
- `/todos trash` lists the trash; `/todos restore <numbers>` puts entries back on the list; `/todos purge <numbers>` removes entries from the trash for good.
- `/todos clear` deletes every item, so the items go to the trash as user deletions and are kept from coming back, as `/todos delete` does.
- `/todos reset` empties both the list and the trash, which lifts every never-add-back block.
- `/todos refresh` reviews the current list item by item against the whole conversation instead of regenerating it: it removes items that are no longer open, adds missing ones, and may rewrite a kept item's detail, while every kept item keeps its title.
- Items the model removed are not added back unless the conversation reopens them; items the user removed are never added back.
- **BREAKING**: The stored entry drops `done` in favor of `trash`. An older version of the mod treats an entry without `done` as invalid and deletes it when a session starts, so downgrading deletes every list this version saved, in every session.

## Capabilities

### New Capabilities

- `stale-item-review`: The periodic review of the list over the recent turns, and `/todos refresh` as a per-item review over the whole conversation.
- `item-trash`: Recording every removal with its source, the never-add-back rules per source, migration from `done`, and the `/todos trash`, `/todos restore`, `/todos purge`, `/todos clear`, and `/todos reset` commands.

### Modified Capabilities

None. The project has no main specs yet.

## Impact

- `hooks/list.ts`: the review prompt and reply parsing, the refresh prompt with the current list, and the removed-items block split by source.
- `hooks/register.tsx`: the review window and its triggers, the trash atom and store field, migration from `done`, the new subcommands, and recording removals from the incremental update, the review, refresh, delete, and clear.
- `types/index.d.ts`: the state contract gains the trash and the review window and loses `done`.
- `tests/todo-list.test.ts`: tests for the review, the trash, the new commands, migration, and refresh.
- `README.md`, `README.zh-TW.md`: How It Works, the cost note, and the `/todos` command table.
- Cost: one extra Sonnet call per review, at most one every 3 turns.
