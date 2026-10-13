## 1. State and Keys

- [x] 1.1 In `types/index.d.ts`, add `windowStart: number` to the `todo-list` plugin state
- [x] 1.2 In `hooks/register.tsx`, add a `windowStart` atom (default 0) and a window size constant of 10; set `PASTE_KEY` to `v` and add next-page and previous-page key constants `n` and `p`
- [x] 1.3 Make `leave()` set `windowStart` back to 0

## 2. Window Logic

- [x] 2.1 Add a pure helper that takes the list length, the stored start, and the focused index (or none) and returns the start to show: moved the least distance that keeps the focused item in the window, then held within `[0, max(0, length - 10)]`
- [x] 2.2 Make `focusItem` store the helper's result for the newly focused index, so `j`/`k`, `Tab`/`Shift+Tab`, and the wrap-around scroll the window by the least distance
- [x] 2.3 Add a paging function for `n` and `p`: do nothing in the detail view, with 10 or fewer items, or when the clamped start does not change; otherwise move the ring with `$.ui.focus` to the row the same distance away, then update the focus and `windowStart`, so the focus keeps its row in the window
- [x] 2.4 Move the window arithmetic into `hooks/list.ts` as exported pure helpers (`WINDOW_SIZE`, `windowFor`, `pageFor`), and in the paging function call `focusItem` before setting the page's start

## 3. Band Render

- [x] 3.1 In the `AbovePrompt` render, compute the shown start with the helper and draw only the rows inside the window, keeping every other row's zero-size box and Button as the detail view does; keep list-wide numbers and the number width of the whole list
- [x] 3.2 Under the window, draw a dim `<n> more` line counting the items after it, and nothing when there are none
- [x] 3.3 Add zero-size hotkey Buttons for next page and previous page beside the others, wired to the paging function, and move the paste Button to `v`
- [x] 3.4 Make `helpLine` name `v` for paste, and name `n/p page` only when the list holds more than 10 items
- [x] 3.5 Hide the `<n> more` line and leave `n/p page` out of the help line in the detail view

## 4. Tests

- [x] 4.1 Test the window: 25 items show rows 1 through 10 with `15 more`; the last window shows no `more` line; 7 items show whole with no `more` line
- [x] 4.2 Test focus scrolling: moving past the window's bottom or top scrolls one item; wrapping from the last item shows the top; a `Tab` onto a hidden row scrolls to it
- [x] 4.3 Test paging: through the pure paging helper, next page keeps the focus row, next page stops at the end with the focus row held, and previous page stops at the top; by pressing the keys, paging at an edge and on a 10-item list changes nothing; paging in the detail view changes nothing
- [x] 4.4 Test that leaving the band returns the window to the top, and that deleting an item in the last window pulls the window up so it stays full
- [x] 4.5 Update the paste tests for the `v` hotkey, assert the paging Buttons carry `n` and `p`, and test the help line with and without `n/p page` at 11 and 10 items
- [x] 4.6 Run `claude plugin validate .` and `claude plugin test .` and fix any failure

## 5. Documentation and Release

- [x] 5.1 Update the band section in `README.md` and `README.zh-TW.md`: the 10-item window and `<n> more` line, `n`/`p` for paging, and `v` for paste
- [x] 5.2 Bump the minor version in `.claude-plugin/plugin.json` to 0.7.0
- [x] 5.3 Describe `hooks/list.ts` in the README development tables as also holding the band's window arithmetic
