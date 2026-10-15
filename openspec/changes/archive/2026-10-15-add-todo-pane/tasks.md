## 1. Window Arithmetic

- [x] 1.1 In `hooks/list.ts`, make `windowFor` and `pageFor` take the window size as a parameter, keeping `WINDOW_SIZE` as the band's cap, and update their callers to pass it
- [x] 1.2 Add a pure helper that returns the window size from the rows available, the list length, the rows the other lines take, and an optional cap: the whole list when it fits with the other lines, otherwise the rows left after reserving the `<n> more` row, at least 1 while the list has items
- [x] 1.3 Add a pure helper that counts the rows a text takes in a given number of columns under word wrap: starting a row at each newline, breaking at spaces for Latin text and anywhere for wide characters, with the existing cell width rules (move `charWidth` and `cellWidth` into `hooks/list.ts` if the helper needs them there)

## 2. View Record and Shared Actions

- [x] 2.1 In `types/index.d.ts`, add `paneFocused`, `paneFocusIndex`, `paneDetailed`, `paneDeleting`, `paneSelected`, and `paneWindowStart` to the `todo-list` plugin state
- [x] 2.2 In `hooks/register.tsx`, add the pane atoms and a `View` record type holding a view's atoms, its site (component and request id), and its size key; build the band's record from the existing atoms and the pane's from the new ones
- [x] 2.3 Add a module-level map of the window size each view last drew, defaulting to 10 before a view's first draw
- [x] 2.4 Make `focusItem`, `moveFocus`, `movePage`, `toggleDetails`, `toggleSelected`, `toggleAll`, `paste`, `askAbout`, `deleteFocused`, `disarm`, and `setSelected` take the view, read and write its atoms, move the ring on its site, and size the window from the map; keep `leave()` band-only
- [x] 2.5 Record the band render's `isWorking` prop in a module-level flag before any early return, and make `askAbout` read that flag instead of taking `isWorking` as an argument
- [x] 2.6 For the pane's view, resolve the focus from the focused title, or else the stored focus index clamped to the list, and write both whenever the pane's focus moves

## 3. Band Window

- [x] 3.1 In the `AbovePrompt` render, compute the other lines' rows (rule, heading, help line wrapped in `bodyColumns`, and the focused title's extra rows), size the window from `maxRows` with a cap of 10, store the size in the map, and clamp the shown start with it
- [x] 3.2 Make the `<n> more` line and `helpLine`'s `n/p page` depend on the list holding more items than the window instead of more than 10
- [x] 3.3 Add a `w` hotkey Button beside the band's other hidden Buttons that opens the pane, and name `w pane` in the band's help line

## 4. Pane

- [x] 4.1 Add an `openPane` function that returns early when `$.ui.panes()` lists the pane's id, and otherwise calls `$.ui.open` with the pane's id, the title `Todos`, and `focus: true`, without `closeOnEscape`
- [x] 4.2 Add `/todos pane`, matched exactly beside `refresh` and `clear`, which calls `openPane`; `/todos pane <text>` keeps falling through to the prompt
- [x] 4.3 Add a `ui.render` hook for the `Pane` component and the pane's id: the `Todos` heading, the window sized from `scroll.bodyRows` with no cap (counting the expanded detail's rows), the rows drawn by a function shared with the band's render, the focus dot dim while `isFocused` is false, the focused item's detail under its row when expanded, the `<n> more` line, the help line, and the pane's hidden hotkey Buttons bound to the pane's view; `No open items.` with an empty list
- [x] 4.4 Give the focused row's Button `autoFocus` so the ring lands on the stored item when the pane takes the keys, and do not draw the `delete?` mark while the pane lacks the keys
- [x] 4.5 Add a `ui.focus` hook for the `Pane` component that disarms the pane's armed delete when the ring comes back, redirects the ring to the stored focused row when it enters the pane elsewhere, and infers the direction for the hidden hotkey Buttons as the band's hook does
- [x] 4.6 Add a `ui.close` hook for the pane's id that clears all of the pane's atoms
- [x] 4.7 Extend `helpLine` with the view's differences: the pane names `o` as expand or collapse and leaves out `w`; an unfocused pane names `Ctrl+X Tab`
- [x] 4.8 Clear the pane's state on the `/clear` path beside the band's atoms, and name `pane` in the `/todos` command's description and argument hint

## 5. Tests

- [x] 5.1 Test the pure helpers: window size when the list fits, when it does not, at the minimum of 1, and with and without the cap; the wrap counter on Latin, CJK, and mixed text; `windowFor` and `pageFor` with a window of 4
- [x] 5.2 Test the fitted band window with `maxRows` of 20, 8, and 3, mounted with a `bodyColumns` wide enough for the focused help line to fit on one row: items shown, the `<n> more` count, `n/p page` in the help line for a 7-item list in 8 rows, a wrapped focused title taking a row, and a window that shrinks around the focus when the band is mounted again with fewer rows; at `bodyColumns` 80, test that focusing an 8-row band whose help line wraps to two rows shows 3 items instead of 4
- [x] 5.3 Test opening: `/todos pane` calls `$.ui.open` with `focus: true` and no `closeOnEscape`; the band's `w` calls it; both do nothing when the pane is already listed; `/todos pane <text>` sends the prompt; session start and a squeezed band do not open it
- [x] 5.4 Test the mounted pane: a 25-item list in 40 body rows shows every item, in 12 body rows shows 9 with `16 more`; `o` expands the focused item's detail inline with the other rows still drawn; `j` moves the expansion; `o` again collapses it; the empty list shows `No open items.`
- [x] 5.5 Test the pane's state: its selection and focus are apart from the band's; the band's `Esc` and `prompt.edit` leave the pane's selection, focus, and detail; a successful `v` clears the pane's selection; `ui.close` clears every pane atom; a band delete under the pane's focus moves it to the item at the same position; the dot is dim while `isFocused` is false
- [x] 5.6 Test the pane's help line focused and unfocused, with and without `n/p page`
- [x] 5.7 Run `claude plugin validate .` and `claude plugin test .` and fix any failure

## 6. Documentation and Release

- [x] 6.1 Update `README.md` and `README.zh-TW.md`: the band's window fitting its rows, `w` in the band's key table, `/todos pane` in the command table, and a pane section covering how it opens, its keys, the inline detail, its kept state, `Esc` and `Ctrl+X X`, and the two `Ctrl+X Tab` presses from the prompt box
- [x] 6.2 Bump the minor version in `.claude-plugin/plugin.json` to 0.9.0
