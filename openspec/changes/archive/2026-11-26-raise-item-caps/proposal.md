## Why

A long session reached the list's 99-item cap, after which new open items were dropped without notice. On the Anthropic API the `sonnet` alias now resolves to a model with a 1M-token context window, so the whole list fits in each update well past 99 items.

## What Changes

- The list holds at most 999 items, up from 99. What happens at the cap is unchanged: the items already on the list stay, and additions that do not fit are dropped.
- The trash's two caps part ways. It keeps the newest 999 entries the user removed, the same as the list's cap, so one `/todos clear` of a full list is always fully restorable. It keeps the newest 99 entries the model removed, as before.
- `/todos restore` is cancelled whole when the list has no room for every entry it would add. Until now the entries left the trash, the list cut them off at its cap, and the reply still said `Restored`.
- A review may reply with as many tokens as a per-turn update, so a reply that removes several hundred items is not cut off.
- A per-turn update or a review may take 120 seconds, up from 60, to allow for the longer list in the request.
- The READMEs state the list's cap, the two trash caps, and the cancelled restore, and say that on a model with a smaller context window a very long list can stop updating before it reaches the cap.

## Capabilities

### New Capabilities

- `item-list-cap`: the most items the list holds, and what happens to additions that do not fit.

### Modified Capabilities

- `item-trash`: the trash keeps 999 user entries and 99 model entries instead of 99 of each, and a restore the list has no room for is cancelled whole.

## Impact

- `hooks/list.ts`: the list's cap, and one trash cap per source.
- `hooks/register.tsx`: the trash trims each source to its own cap; `/todos restore` checks the list's room first; the review's reply cap and the completion timeout.
- `tests/todo-list.test.ts`: tests for the list's cap, the two trash caps, the cancelled restore, and the review's reply cap.
- `README.md`, `README.zh-TW.md`: the caps, the cancelled restore, and the note on context windows.
- Saved lists keep their format. When an older version opens a session saved with more than 99 items, its next list update moves the items past 99 to the trash, which keeps 99 of them.
- A minor version bump at release.
