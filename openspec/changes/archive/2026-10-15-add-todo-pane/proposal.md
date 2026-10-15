## Why

In fullscreen the engine fits the band and the prompt box into half the terminal, laying out the prompt first, so a long draft squeezes the band to a row or two and the engine scrolls the rest out of view. That defeats the band's main use: reading the list while writing a prompt, often one that `v` filled with quoted items. The mod cannot cap the prompt or claim more rows, and the band's fixed 10-item window ignores the rows it gets, so `n`/`p` and the help line stop working once the engine starts scrolling.

## What Changes

- The band's window holds as many items as fit in the rows the engine gives it, never more than 10, so the engine no longer scrolls the band in list view. `n`/`p` page by the window as drawn, and the help line names them whenever the list does not fit in the window.
- A new pane view lists the items in a pane, which the surface docks beside the transcript in fullscreen from 110 columns, floor to ceiling, so its height does not depend on the prompt.
- `w` on the band and `/todos pane` open the pane. Both only open it: on an open pane they do nothing. The engine's `Ctrl+X X` closes it, and `Esc` hands the keys back to the prompt without closing it.
- The pane has the band's keys: `j`/`k`, `Tab`/`Shift+Tab`, `s`, `a`, `n`/`p`, `v`, `o`/`Enter`, `b`, and `d`. Its window holds as many items as fit, with no 10-item cap. `o`/`Enter` expands the focused item's detail under it, one item at a time, with the rest of the list still shown.
- The pane keeps its own focus, expanded detail, selection, and armed delete, apart from the band's. Typing in the prompt box does not reset them; a successful paste clears the pane's selection; closing the pane clears all of them. While the pane does not hold the keys, its focus dot is drawn dim.
- The band keeps showing while the pane is open, and its keys and leave rules are unchanged apart from the window size. The pane never opens on its own: not at session start, after a resume, or when the band is squeezed. With an empty list the pane shows `No open items.` and stays open.
- `/todos pane`, with nothing after it, no longer sends `pane` as a prompt with the items quoted. `/todos pane <text>` still sends the prompt.

## Capabilities

### New Capabilities

- `todo-pane`: The pane view: how it opens and closes, its window and paging, its keys, the inline detail, its own focus and selection state and when that state resets, and the empty-list message.

### Modified Capabilities

- `band-item-window`: The window holds as many items as fit in the band's rows, up to 10, instead of a fixed 10; paging moves by the window as drawn; the help line names the paging keys whenever the list does not fit in the window; the band gains the `w` key that opens the pane.

## Impact

- `hooks/list.ts`: the window and paging helpers take the window size as a parameter; a helper sizes the band's and the pane's windows from their rows.
- `hooks/register.tsx`: the `AbovePrompt` render reads `maxRows`; the band actions take the view they act on; a `Pane` render, `ui.focus` and `ui.close` hooks for the pane; the `w` hotkey Button; the `/todos pane` subcommand.
- `types/index.d.ts`: the plugin state gains the pane's focus, detail, selection, armed delete, and window start.
- `tests/todo-list.test.ts`: tests for the fitted band window, the pane's opening, keys, window, inline detail, state rules, and the empty list.
- `README.md`, `README.zh-TW.md`: the band's description and key table, the pane, and `/todos pane`.
- `.claude-plugin/plugin.json`: minor version bump at release.

## Amendments

Made after archiving, from use in a real terminal; the main specs `band-item-window` and `todo-pane` carry the resulting behavior, and this change's design.md and specs record the design as first archived.

- **The band hides while the pane is open, and `t` replaces `w`.** With the band shown, `Ctrl+X Tab` could not reach the pane: the chord is bound only while the prompt box holds the keys, so a second press inside the band is a plain `Tab`. `t` on the band switches to the pane and hides the band; `t` on the pane, `Ctrl+X X`, or the close mark closes it and brings the band back. The band hides only once the engine reports the pane placed, so the list always has a view.
- **`/todos pane` focuses an open pane.** It asks for the keys also when the pane is already open, which gives a way into the pane from an empty prompt box.
- **A first focus lands on the first shown item.** Without an `autoFocus` row, the ring started on nothing when the pane first took the keys, so its keys had no item to act on.
- **A persistent default view.** A `default_view` user setting (`band` or `pane`, in `/config`) opens the pane at the first session start of the process, without asking for the keys so typing still goes to the prompt box. This replaces the rule that the pane never opens on its own.
- **Wrapped titles and a window in rows.** The pane draws every title whole, and its window and paging are computed in rows rather than items. The band keeps its count-based window.
- **No focus dot while the pane lacks the keys.** As in the band, the dot is not drawn once the pane is left; the pane still keeps its focus and returns to it.
