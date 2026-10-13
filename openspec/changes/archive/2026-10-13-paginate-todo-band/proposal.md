## Why

The band draws every item on the list, up to 99 rows. The engine caps the band's room (half the terminal in fullscreen, the whole terminal otherwise) and scrolls a taller tree on its own, so a long list pushes the help line out of view and leaves the person scrolling the engine's window instead of moving through the items. A fixed 10-item window with its own paging keys keeps the band short and predictable.

## What Changes

- The band shows at most 10 items at a time, as a window over the list. Items keep their list-wide numbers, so the 11th item is numbered 11, as `/todos delete`, `/todos restore`, and pasted quotes number it.
- A dim `<n> more` line under the window counts the items after it, and is absent when there are none.
- `j`/`k` and `Tab`/`Shift+Tab` keep moving the focus one item at a time. When the focus would leave the window, the window scrolls just far enough to keep it in view; a wrap from the last item to the first, or back, moves the window to the focus.
- `n`/`p` move the window down or up by up to 10 items, so the window stays full, and the focus keeps its row within the window. They do nothing in the detail view, with 10 or fewer items, or when the window cannot move further.
- The help line names `n/p page` only while the list holds more than 10 items.
- The window's position lasts only while the band holds the focus: leaving the band puts it back at the top.
- **BREAKING**: Paste moves from `p` to `v`, since `p` now moves to the previous page. It ships as a minor version bump.

## Capabilities

### New Capabilities

- `band-item-window`: The band's 10-item window, the `<n> more` line, how focus moves scroll the window, the `n`/`p` paging keys, the `v` paste key, and when the window resets.

### Modified Capabilities

None. The existing specs (`item-trash`, `stale-item-review`) do not cover the band's keys or layout.

## Impact

- `hooks/list.ts`: the window size and the pure window and paging helpers.
- `hooks/register.tsx`: key constants, the `AbovePrompt` render, `focusItem`, a window atom and paging function, `helpLine`, and `leave`.
- `types/index.d.ts`: the plugin state gains the window's start.
- `tests/todo-list.test.ts`: tests for the window, the `<n> more` line, focus scrolling, paging, the detail view, the reset on leave, and paste on `v`.
- `README.md`, `README.zh-TW.md`: the band's key table and description.
- `.claude-plugin/plugin.json`: minor version bump at release.
