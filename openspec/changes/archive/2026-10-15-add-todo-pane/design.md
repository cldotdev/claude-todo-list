## Context

See proposal.md (Why) for the motivation, and specs/band-item-window/spec.md and specs/todo-pane/spec.md for the behavior.

The band is drawn by the `ui.render` hook on `AbovePrompt` in `hooks/register.tsx`. Its interaction state lives in five `$.state` atoms (`focused`, `detailed`, `deleting`, `selected`, `windowStart`), and every action (`focusItem`, `moveFocus`, `movePage`, `toggleDetails`, `toggleSelected`, `toggleAll`, `paste`, `askAbout`, `deleteFocused`, `disarm`) reads and writes those atoms directly. `leave()` clears them on `prompt.edit`, `prompt.submit`, a `ui.focus` with no element, and the `watchLeave` poll, because the band raises no event when `Esc` leaves it. The window helpers `windowFor` and `pageFor` in `hooks/list.ts` use the fixed `WINDOW_SIZE` of 10, and render ignores the `maxRows` prop.

Engine facts the design rests on, from `.claude-plugin/types/claude-code/index.d.ts`:

- `AbovePrompt.maxRows` is what the bottom slot has left above the prompt in fullscreen, the slot being half the terminal with the prompt included; a taller tree is scrolled by the engine.
- A `Pane` render gets `isFocused`, `bodyColumns`, `placement`, and `scroll.bodyRows`, the most rows the frame may take less the engine's own.
- `$.ui.open` from a command or a press is placed at any width; `focus: true` is granted only while the prompt is empty and nothing else holds the keys. Opening an open id only retitles it.
- A Button `hotkey` fires while its site holds the keys, for the band and a pane alike. `autoFocus` puts the ring on a Button when the site takes the keys.
- Mods cannot define keybinding actions, so the pane gets no chord of its own.

## Goals / Non-Goals

**Goals:**

- One set of action functions serves both views, so a key behaves the same in the band and the pane apart from the documented differences.
- The band's existing state keys, leave rules, and tests keep working unchanged, apart from the window size.
- One pure helper sizes both windows, so render and the key handlers agree on how many items a window holds.

**Non-Goals:**

- Dropping the band's rule or heading to win rows when it is squeezed. The pane is the answer to a squeezed band; the band keeps its layout.
- Remembering whether the pane was open across sessions, or opening it on any signal other than `w` and `/todos pane`.
- A chord that opens the pane from the prompt box.
- Splitting `hooks/register.tsx` into more files.

## Decisions

### Window Size Is a Parameter Sized From the Rows

`windowFor` and `pageFor` take the window size instead of reading `WINDOW_SIZE`; `WINDOW_SIZE` stays as the band's cap. A new pure helper in `hooks/list.ts` returns the window size from the rows available, the list length, the rows the view's other lines take, and the cap: if the whole list fits with the other lines it returns the list length (capped); otherwise it reserves the `<n> more` row and returns what is left, at least 1. The band calls it with `maxRows` and a cap of 10; the pane calls it with `scroll.bodyRows` and no cap. Alternative: let the engine keep scrolling and only fix `n`/`p`. Rejected because the help line and the `<n> more` line would still be scrolled away.

### Wrapped Rows Are Counted With a Word-Wrap Estimate

The other lines include the help line and the focused title, both drawn with `wrap`. A pure helper counts the rows a text takes in `bodyColumns` (less the gutter and number label for a title), starting a row at each newline, breaking at spaces for Latin text and anywhere for wide characters, using the existing cell width rules. Alternative: `ceil(cellWidth / columns)`. Rejected because word wrap often takes one row more than the cell count suggests, which would make the band one row taller than `maxRows` and bring the engine's scroll back. The pane counts the expanded detail's rows the same way.

### The Band Sizes From the Help Line It Draws

The band's help line is one short row (`Ctrl+X Tab to focus`) while the band lacks the focus and a long one, naming every key, while it holds the focus; on a terminal narrower than the long line, it wraps to two rows. The window is sized from the help line actually drawn, so taking the focus can shrink a squeezed band's window by one item and raise the `<n> more` count by one. Alternative: always reserve the focused help line's rows. Rejected because it costs a squeezed band an item for the whole time it is not focused, which is most of the time, to avoid a one-item change at the moment the user focuses it.

### Handlers Use the Size Render Last Drew

Key handlers run outside render and do not see `maxRows` or `scroll.bodyRows`. Each view's render stores the window size it drew in a module-level map keyed by view, which `focusItem` and `movePage` read; before a view's first draw, and after a hot reload until render runs, the size is 10. Render still clamps the start with the current size on every draw, so a resize keeps the focus in view without any write, which is what the "Window Follows the Band's Rows" requirement needs. Alternative: an atom in `$.state`. Rejected because writing state from render redraws it, and the size is derived from props, not state.

### A View Record Parameterizes the Actions

A `View` record holds, for each of a view's atoms (focus, detail, armed delete, selection, window start, and for the pane the focus index), a `get` and a `set` closure over `$`, plus the view's `kind` (`band` or `pane`) and the `requestId` its ring moves on. The engine's state scan reads only atoms named directly in a `read` or `update` call, and rejects `$` passed as an argument, so the record cannot hold the atoms themselves; `bandView($, requestId)` and `paneView($)` build it per render or hook. `kind` keys the map of drawn window sizes, and `$.ui.focus` needs only the `requestId`, so the record carries no component. The band's closures reach the existing atoms, so their keys and the band's leave rules do not change; the pane's reach new atoms (`paneFocused`, `paneFocusIndex`, `paneDetailed`, `paneDeleting`, `paneSelected`, `paneWindowStart`) declared in `types/index.d.ts`. Every action takes the view as its argument after `$` (or as its only argument when it touches no other state), and the hotkey Buttons in each render pass their own view. `leave()` stays band-only. Alternative: one atom holding a record per view. Rejected because it renames the band's state keys and churns the existing tests for no behavior gain.

### The Pane Remembers Its Focus by Title and Position

The band keeps its focus as a title only. The pane also stores the index it last focused, and resolves its focus as the title's current index, or else the stored index clamped to the list, so an item removed by a model update, a band delete, or `/todos delete` hands the focus to the item now at that position. Selections stay titles; `pickedFrom` already drops titles that left the list.

### Opening Checks the Open Panes First

`w` (a hotkey Button beside the band's other hidden Buttons) and `/todos pane` (an exact match beside `refresh` and `clear`, so `/todos pane <text>` still falls through to the prompt) call one `openPane` function. It returns early when `$.ui.panes()` lists the pane's id, so an open pane keeps its state and a granted focus does not jump; otherwise it calls `$.ui.open({ id, title: 'Todos', focus: true })` without `closeOnEscape`. Alternative: rely on the retitle-only behavior of opening an open id. Rejected because `focus: true` on that call could still move the keys.

### The Pane Has No Leave Poll

The pane's render reads `isFocused` to dim the focus dot, so it needs no `watchLeave`. The render also copies `isFocused` into a module-level `isPaneHeld` flag, which is how the pane's `ui.focus` hook tells the ring entering the pane from a move inside it: the first stop after the pane lacked the keys is an entry, which disarms an armed delete and redirects the ring to the stored row. Its state is cleared by the `ui.close` hook for its id, and by the `/clear` path that already resets the band's atoms, so a cleared conversation leaves no stale focus or selection in an open pane. An armed delete is not drawn while the pane lacks the keys, and the entry disarms it, which is how `Esc` cancels it without an event for `Esc` itself. The focused row's Button carries `autoFocus`, so the ring lands on the stored item when the pane takes the keys. The pane's `ui.focus` hook mirrors the band's direction inference for the hidden hotkey Buttons.

### The Pane Reads the Working Flag the Band Records

`askAbout` toasts that the `/btw` answer waits for the turn when `isWorking` is true, and only the `AbovePrompt` props carry `isWorking`. The band's render records it in a module-level flag before any early return, so it is current even when the band draws nothing, and the pane's `b` reads that flag. Alternative: track turns with `turn.start` and a turn-end hook. Rejected as a second source for a fact the engine already hands the band on every draw; a stale flag only changes whether a toast shows.

### The Pane Draws Rows Like the Band, With the Detail Inline

Both renders build each row with one shared function: dot, list-wide number, title with the note dimmed, the selection color, and the `delete?` mark. The pane draws no rule (its frame separates it), keeps the `Todos` heading because a single pane shows no tab title, and draws the expanded detail under the focused row instead of switching to a one-item view. Hidden rows keep zero-size Buttons in both views, as the band does today. The help line comes from the shared `helpLine` with the view's differences: the pane names `o` as expand or collapse and has no `w`; the band adds `w pane`.

## Risks / Trade-offs

- [The word-wrap estimate disagrees with the terminal's wrapping] → The band comes out a row too tall and the engine scrolls one row, today's behavior in a milder form. The counter is unit-tested on Latin, CJK, and mixed titles.
- [`autoFocus` may not move the ring back once the person has moved it, since the engine keeps a moved ring where it was put] → The pane's `ui.focus` hook redirects the first stop the ring lands on to the stored row with `next({ ...e, element })`, as the band's hook does for its rows.
- [Focusing a squeezed band shrinks its window by one item when the long help line wraps] → Accepted; see "The Band Sizes From the Help Line It Draws".
- [A key press between a resize and the next draw uses the old window size] → The next draw clamps the start with the new size, so the focus stays in view; only that one page step uses the old size.
- [From the prompt box, the pane is two `Ctrl+X Tab` presses away, since focus goes to the band first] → Documented in the README. A chord of its own needs an engine change.
- [After `w`, the pane opens without the keys because the band holds them] → The engine's rule; the spec states it, and the README names the second `Ctrl+X Tab`.
- [The test kit cannot answer the plugin's own `$.ui.focus` call, so no test presses `j`/`k` or `n`/`p` through to a moved ring in either view] → The window and paging arithmetic is tested through the pure helpers; the pane's focus moves, and the expansion following them, are tested by raising `ui.focus` on the mounted pane.
- [The test kit's `$.ui` cannot raise `ui.close`] → The `ui.close` hook only calls the function `/clear` also calls, and that function is tested through `/clear`.
- [`hooks/register.tsx` grows past 1,100 lines] → The view record keeps one copy of each action; the pane adds a render and three hooks.

## Migration Plan

No stored data changes: the new atoms live in `$.state`. The release bumps the minor version for the new pane, the `w` key, and the `/todos pane` subcommand. Rolling back restores the fixed 10-item band and drops the pane, with no effect on saved lists.

## Open Questions

- Whether an inline pane, placed below 110 columns, shares the half-terminal cap with the prompt. The pane sizes its window from `scroll.bodyRows` either way, so the answer changes how many items it shows, not the approach.
