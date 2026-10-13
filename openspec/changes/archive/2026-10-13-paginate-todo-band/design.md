## Context

See proposal.md (Why) for the motivation and specs/band-item-window/spec.md for the behavior. The band is drawn by the `ui.render` hook on `AbovePrompt` in `hooks/register.tsx`. Its focus is a title in the `focused` atom; `focusItem` sets it, and both `moveFocus` (`j`/`k`) and the `ui.focus` hook (`Tab`/`Shift+Tab`, and the leave check) go through it. The engine's focus ring tracks its stops by position, so every row keeps a Button in every view: the detail view already hides the other rows inside zero-size boxes rather than dropping them. Letter hotkeys are zero-size Buttons beside the help line and fire only while the band holds the focus. `leave()` clears the focus, the selection, an armed delete, and the detail view when the band loses the focus.

## Goals / Non-Goals

**Goals:**

- One place computes which items the window shows, so render, focus moves, and paging cannot disagree.
- The window's position never needs saving or migrating.

**Non-Goals:**

- Replacing the engine's own scrolling. On a terminal too short for 10 rows plus the header and help line, the engine still scrolls the band.
- Making the window size configurable.
- Paging in the detail view, or a page indicator.

## Decisions

### The Window Start Is an Index in `$.state`

A new `windowStart` atom holds the index of the window's first item. It lives in `$.state`, not the store, like the focus and the selection: it lasts only while the band holds the focus, and `leave()` sets it back to 0. Alternative: derive the window from the focused index (`floor(index / 10) * 10`). Rejected because the settled behavior scrolls one item at a time on `j`/`k` and keeps the focus row on `n`/`p`, so the start is not a function of the focus. Alternative: anchor the window to an item's title so it survives edits above it. Rejected as more state for little gain: the list changes under the window only on model updates and deletes, and the clamp below keeps the focus in view either way.

### One Clamp Decides What the Window Shows

A pure helper in `hooks/list.ts`, beside the other pure list logic and exported for the tests, takes the list length, the stored start, and the focused index (or none), and returns the start to show: first moved by the least distance that keeps the focused item inside the 10 rows, then held within `[0, max(0, length - 10)]`. Render calls it on every draw, so a list that shrinks or shifts under the window (a delete, a model update) is shown full and with the focus in view without any write. Focus moves call it too and write the result back, because the next move must start from where the window is shown; otherwise a `k` after a one-item scroll would snap back to the stale start.

### Focus Moves Scroll Through `focusItem`

`focusItem` is the one path every focus change takes, so it is where the window follows the focus: after setting the focused title it stores the clamped start for the new index. That covers `j`/`k`, `Tab`/`Shift+Tab`, and the wrap-around with no change to `moveFocus` or the `ui.focus` hook's direction inference.

### Paging Moves the Start and the Focus Together

A second pure helper in `hooks/list.ts` adds or subtracts 10 from the shown start, clamps it to `[0, length - 10]`, and moves the focused index by the same distance the start actually moved, so the focus keeps its row; it returns nothing when the clamp leaves the start unchanged, which also covers a list of 10 or fewer items. The paging function does nothing in the detail view or when the helper returns nothing. Otherwise it moves the ring with `$.ui.focus` to the new row's key before updating the atoms, as `moveFocus` does, because the ring tracks stops by position and the leave check would otherwise pull it back. It then calls `focusItem`, which cancels a delete armed on another item, and sets the page's start last: `focusItem` scrolls the least distance from the old focus, which would otherwise pull the window back toward it.

### Hidden Rows Keep Their Buttons

Rows outside the window render the same zero-size box with a Button that the detail view uses for the other rows. Dropping them would shift the ring's stops, as the existing comment in render explains.

### Keys

`n` and `p` become paging hotkeys and paste moves to `v`, each as a zero-size hotkey Button beside the help line like the others. Neither `n` nor `v` is bound in the band today. The help line names `n/p page` only while it shows the list and the list holds more than 10 items, so a short list's line does not grow.

## Risks / Trade-offs

- [Muscle memory: `p` used to paste] → Pressing `p` now pages up or does nothing; it never deletes or sends anything. The minor version bump and the README key table carry the change.
- [`n` moves fewer than 10 items near the end] → Intended: the window stays full, and the focus row holds, so the focused item moves by the same shorter distance.
- [A model update above the window shifts the shown items] → The clamp keeps the focused item in view; the other rows may shift by the number of items added or removed above, as the numbering already does today.
- [The test kit cannot answer a plugin's own `$.ui.focus` call, so no test presses `n` or `p` through to a moved window] → The paging arithmetic, including the focus row and the clamp at either end, is tested through the pure helper; the early returns (detail view, an edge, a short list) are tested by pressing the keys. The order of the ring move, `focusItem`, and the start update is not exercised by a test.
- [The band can still exceed the engine's room on a short terminal] → The engine scrolls it as it does now; the window caps the band at about 14 to 16 rows.

## Migration Plan

Nothing is stored or migrated: the window start lives only in `$.state`. The release bumps the minor version because of the paste key. Rolling back to the previous version restores `p` as paste and the unbounded band, with no effect on saved lists.
