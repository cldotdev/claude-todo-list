# Todo Pane

## Purpose

Shows the list in a pane whose height does not depend on the prompt box, with the band's keys, so the list can be read and worked while a long prompt squeezes the band.

## Requirements

### Requirement: The Pane Opens on Request

The pane SHALL open when the user presses `t` while the band holds the focus, or runs `/todos pane` with nothing after it. Each SHALL ask the engine to open the pane with the keys, also when the pane is already open, and SHALL switch the view mode to pane only once the engine reports the pane drawn; when it cannot draw the pane, the band SHALL stay shown and `/todos pane` SHALL reply `The Todos pane cannot be shown here.` `/todos pane` followed by other text SHALL keep sending that text as a prompt with the items quoted, as `/todos <prompt>` does. The pane gets the keys only when the engine grants that, which it does not while the prompt box holds text or the band holds the focus.

#### Scenario: The Command Opens the Pane

- **WHEN** the pane is closed and the user runs `/todos pane`
- **THEN** the pane opens and shows the list, and the command replies `The Todos pane is open.`

#### Scenario: The Command Takes the Keys From an Empty Prompt

- **WHEN** the pane is closed, nothing else holds the focus, and the user runs `/todos pane`
- **THEN** the pane opens holding the keys

#### Scenario: The Command Focuses an Open Pane

- **WHEN** the pane is open without the keys, the prompt box is empty, and the user runs `/todos pane`
- **THEN** the pane asks for the keys again and takes them, with its focus unchanged

#### Scenario: T Opens the Pane Without the Keys

- **WHEN** the pane is closed, the band holds the focus, and the user presses `t`
- **THEN** the pane opens, the band is no longer drawn, and one `Ctrl+X Tab` moves the keys to the pane

#### Scenario: A Pane That Cannot Be Drawn Keeps the Band

- **WHEN** the list holds 3 items, the surface cannot draw the pane, and the user runs `/todos pane`
- **THEN** the command replies `The Todos pane cannot be shown here.` and the band still shows the list

#### Scenario: Text After Pane Still Goes Out as a Prompt

- **WHEN** the list holds 3 items and the user runs `/todos pane layout looks wrong`
- **THEN** the prompt `pane layout looks wrong` is sent with the 3 items quoted above it

### Requirement: The Band Is Hidden While the Pane Is Open

The mod SHALL keep a view mode, band or pane, for the session only and never save it with the list. A new session and a resumed session SHALL start in band mode unless the `default_view` setting is `pane` and the pane is drawn, as the default-view requirement says. While the mode is pane, the band SHALL draw nothing, so the list shows in one place and `Ctrl+X Tab` from the prompt box reaches the pane.

#### Scenario: The Band Is Not Drawn in Pane Mode

- **WHEN** the list holds 3 items and the view mode is pane
- **THEN** the band draws nothing

#### Scenario: A Session Starts in Band Mode

- **WHEN** a session starts or is resumed with items on the list and `default_view` is `band`
- **THEN** the view mode is band and the band shows the list

### Requirement: The Default View Setting Opens the Pane at Session Start

The plugin SHALL declare a `default_view` user setting, a string with the options `band` and `pane` and the default `band`, which `/config` shows as `todo-list.default_view`. When a session starts or is resumed, the mod SHALL read the setting with `$.config.list()` and, when it is `pane`, open the pane without asking for the keys, so the first letters typed into the prompt box are not taken as the pane's keys, also while the list is empty. A missing row, an unreadable list of rows, or any other value SHALL leave the band. When the engine does not draw the pane, such as in a terminal too narrow for a pane nobody asked for, the band SHALL stay. The setting SHALL apply only at the first session start of the process: a hot reload of the mod, which runs `session.start` again, SHALL NOT apply it again, and `/clear`, which raises no `session.start`, SHALL NOT either. A change made in `/config` during a session SHALL take effect at the next session start; `t` switches at once.

#### Scenario: A Pane Default Opens the Pane at Start

- **WHEN** `default_view` is `pane`, the engine draws the pane, and a session starts with an empty list
- **THEN** the pane opens asking for the keys, the band is not drawn, and the pane shows `No open items.`

#### Scenario: A Band Default Leaves the Pane Closed

- **WHEN** `default_view` is `band` and a session starts with 3 items on the list
- **THEN** the mod does not open the pane and the band shows the list

#### Scenario: A Pane That Cannot Be Drawn Keeps the Band at Start

- **WHEN** `default_view` is `pane`, the engine cannot draw the pane, and a session starts with 3 items on the list
- **THEN** the band shows the list

#### Scenario: A Reload Does Not Open the Pane Again

- **WHEN** `default_view` is `pane`, the pane opened at the session start, and the mod is hot reloaded
- **THEN** the mod does not ask to open the pane again

#### Scenario: Clearing the Conversation Does Not Open the Pane Again

- **WHEN** `default_view` is `pane` and the user runs `/clear`
- **THEN** the mod does not ask to open the pane again

### Requirement: The T Key Switches Back to the Band

While the pane holds the keys, `t` SHALL close the pane. Every close of the pane, whether by `t`, `Ctrl+X X`, its close mark, or an unload, SHALL set the view mode back to band, so the list is never left without a view.

#### Scenario: T Closes the Pane

- **WHEN** the pane holds the keys and the user presses `t`
- **THEN** the pane closes and the band shows the list

#### Scenario: Any Close Returns the Band

- **WHEN** the pane is open and the user closes it with `Ctrl+X X`
- **THEN** the view mode is band and the band shows the list

### Requirement: The Pane Stays Open Until Closed

The pane SHALL stay open across turns, while the user types in the prompt box, and while it does not hold the keys. `Esc` SHALL hand the keys back to the prompt box and SHALL NOT close the pane. The pane SHALL close only through the engine's close, `t`, `Ctrl+X X` or its close mark. The pane SHALL open on its own only at a session start or resume with `default_view` set to `pane`, as the default-view requirement says; it SHALL NOT open on its own at any other time, such as when the band is squeezed.

#### Scenario: Esc Keeps the Pane Open

- **WHEN** the pane holds the keys and the user presses `Esc`
- **THEN** the prompt box holds the keys and the pane is still open

#### Scenario: A Squeezed Band Does Not Open the Pane

- **WHEN** the pane is closed and the band's rows shrink so that its window holds 1 item
- **THEN** the mod does not open the pane

### Requirement: The Pane Shows a Window That Fits Its Rows

The pane SHALL draw every title it shows whole, wrapped to as many rows as it needs, unlike the band, which cuts an unfocused title to one row. It SHALL show its items as a window over the list, counted in rows: each item takes the rows of its wrapped title, plus the rows of its detail while that is expanded, and the rows available for items are the pane's body rows less the heading, the help line as wrapped, and the `<n> more` line when items come after the window. The window SHALL have no 10-item cap and SHALL hold at least 1 item while the list has any. From its stored start, the window SHALL move the least distance that shows the whole focused item with its detail, and SHALL stay full: when it reaches the last item, its start SHALL move up while the earlier items still fit. Each item SHALL keep its list-wide number. Under the window the pane SHALL show a dim `<n> more` line counting the items after it, absent when none come after it.

#### Scenario: A Tall Pane Shows More Than 10 Items

- **WHEN** the list holds 25 items, the pane has 40 body rows, and every title and the help line fit on one row
- **THEN** the pane shows all 25 items, numbered 1 through 25, and no `more` line

#### Scenario: A Short Pane Counts the Rest

- **WHEN** the list holds 25 items, the pane has 12 body rows, every title and the help line fit on one row, and no detail is expanded
- **THEN** the pane shows items 1 through 9 and `16 more`

#### Scenario: Wrapped Titles Take Their Rows

- **WHEN** the list holds 25 items, the pane has 12 body rows and a one-row help line, items 1, 2, 4, and 5 wrap to 2 rows, item 3 fits on one, and no detail is expanded
- **THEN** the pane shows each title whole, items 1 through 5 (9 rows), and `20 more`

#### Scenario: An Expanded Detail Takes Its Rows

- **WHEN** the pane has 15 body rows and a two-row help line, items 1, 2, 4, 5, and 6 wrap to 2 rows and item 3 fits on one, and the user expands item 1's one-row detail
- **THEN** the pane shows items 1 through 5 where it showed items 1 through 6 before

#### Scenario: The Window Follows the Focus by the Least Distance

- **WHEN** the pane shows items 1 through 5 with item 1's detail expanded in the setting above and the user moves the focus to item 6, whose detail is then expanded
- **THEN** the pane shows items 2 through 6

#### Scenario: The Last Window Is Full

- **WHEN** the list holds 25 items of one row each, the pane has 12 body rows with a one-row help line, and the focus moves to item 25
- **THEN** the pane shows items 16 through 25 and no `more` line

### Requirement: The Pane Has the Band's Keys

While the pane holds the keys, `j`/`k` and `Tab`/`Shift+Tab` SHALL move its focus one item at a time, wrapping from the last item to the first and back, with the window moving the least distance that shows the focused item. `n` SHALL start the next window at the first item after the current window, held so the last window is full, and `p` SHALL make the new window end just before the current start. Both SHALL keep the focus's offset within the window, clamped to the new window's item count, and SHALL change nothing when the window cannot move or the whole list fits. `s` SHALL select or unselect the focused item, `a` SHALL select every item or clear the selection when every item is selected, `v` SHALL paste the selected items, or the focused item when none is selected, into the prompt box quoted with their numbers, `b` SHALL ask `/btw` about the focused item, and `d` SHALL arm a delete of the focused item that a second `d` confirms and `Esc` cancels. Each key SHALL act on the pane's own focus and selection, never the band's.

#### Scenario: J Moves the Pane's Focus

- **WHEN** the pane holds the keys, its focus is on item 2, and the user presses `j`
- **THEN** the pane's focus is on item 3

#### Scenario: Paging in a Short Pane

- **WHEN** the list holds 25 items of one row each, the pane's window holds 9 items and shows items 1 through 9, the pane's focus is on item 3, and the user presses `n`
- **THEN** the window shows items 10 through 18 and the pane's focus is on item 12

#### Scenario: The Last Page Is Full

- **WHEN** the pane's window shows items 10 through 18 of 25 one-row items, with 10 rows for items, and the user presses `n`
- **THEN** the window shows items 16 through 25, and the pane's focus keeps its offset in the window

#### Scenario: Paging Back Ends Before the Window

- **WHEN** the pane's window shows items 16 through 25 of 25 one-row items, with 10 rows for items, the pane's focus is on item 18, and the user presses `p`
- **THEN** the window shows items 7 through 15 and the pane's focus is on item 9

#### Scenario: Paging Counts Rows

- **WHEN** the pane's window shows items 1 through 5 of 25 items whose rows are 2, 2, 1, 2, 2, 2, ..., the pane has 10 rows for items, and the user presses `n`
- **THEN** the window starts at item 6 and shows 4 items, because each takes 2 rows and the `<n> more` line takes 1

#### Scenario: Paging Clamps the Focus Offset

- **WHEN** the window shows items 1 through 4, the focus is on item 4, and the next window shows items 5 through 7
- **THEN** after `n` the pane's focus is on item 7

#### Scenario: A Window That Cannot Move Stays

- **WHEN** the window already shows the last item and the user presses `n`, or it starts at item 1 and the user presses `p`
- **THEN** the window and the focus are unchanged

#### Scenario: V Pastes the Pane's Selection

- **WHEN** the pane holds the keys, items 2 and 5 are selected in the pane, and the user presses `v`
- **THEN** items 2 and 5 are pasted into the prompt box, quoted with their numbers

#### Scenario: A Confirmed Delete Moves the Focus On

- **WHEN** the list holds 5 items, the pane's focus is on item 3, and the user presses `d` twice
- **THEN** item 3 is deleted, goes to the trash as the user's deletion, and the pane's focus is on the item that followed it

### Requirement: The Pane Expands a Detail in Place

`o` and `Enter` SHALL expand the focused item's detail under its title in the pane, with the rest of the window still shown, and SHALL collapse it when it is expanded. At most one detail SHALL be expanded at a time. While a detail is expanded, moving the focus SHALL move the expansion to the newly focused item, and the window SHALL keep the focused item and its detail in view. An item without a detail SHALL show `(No detail. Run /todos refresh to add one.)` when expanded.

#### Scenario: O Expands the Focused Item

- **WHEN** the pane holds the keys, its focus is on item 4, and the user presses `o`
- **THEN** item 4's detail shows under its title and items before and after item 4 are still shown

#### Scenario: The Expansion Follows the Focus

- **WHEN** item 4's detail is expanded in the pane and the user presses `j`
- **THEN** item 5's detail is expanded and item 4's is collapsed

#### Scenario: O Collapses an Expanded Detail

- **WHEN** item 4's detail is expanded in the pane, the focus is on item 4, and the user presses `o`
- **THEN** no detail is expanded

### Requirement: The Pane Keeps Its Own State

The pane SHALL keep its own focus, expanded detail, selection, armed delete, and window position, apart from the band's. The band's focus, selection, and leave rules SHALL NOT change the pane's state, and the pane's SHALL NOT change the band's. Typing in the prompt box, sending a prompt, and handing the keys back with `Esc` SHALL NOT reset the pane's focus, expanded detail, selection, or window. A paste that reaches the prompt box SHALL clear the pane's selection. Closing the pane, and clearing the conversation with `/clear`, SHALL clear all of the pane's state; `/clear` SHALL NOT change the view mode or close the pane. While the pane does not hold the keys, it SHALL keep its focus, window, selection, and expanded detail but SHALL NOT draw its focus dot; when the pane takes the keys again, its focus SHALL be on the item it was on, and when it takes them with no focus yet, its focus SHALL be on the first item in its window, so its keys have an item to act on.

#### Scenario: Typing Keeps the Pane's Place

- **WHEN** the pane's focus is on item 15 with item 15's detail expanded, the user hands the keys back with `Esc`, types in the prompt box, and moves the keys back to the pane with `Ctrl+X Tab`
- **THEN** the pane's focus is on item 15 and item 15's detail is still expanded

#### Scenario: The Band's Leave Does Not Touch the Pane

- **WHEN** items 2 and 3 are selected in the pane, the band holds the focus, and the user leaves the band with `Esc`
- **THEN** items 2 and 3 are still selected in the pane

#### Scenario: A Paste Clears the Pane's Selection

- **WHEN** items 2 and 3 are selected in the pane, the user presses `v`, and the quote reaches the prompt box
- **THEN** no item is selected in the pane

#### Scenario: A First Focus Lands on the First Shown Item

- **WHEN** the pane has never held the keys and the user moves the keys to it with `Ctrl+X Tab`
- **THEN** the pane's focus is on the first item in its window, and `j` moves it to the next item

#### Scenario: The Unfocused Pane Draws No Dot

- **WHEN** the pane's focus is on item 4 and the prompt box holds the keys
- **THEN** the pane draws no focus dot, and when the pane takes the keys again the dot is on item 4

#### Scenario: Closing Clears the Pane's State

- **WHEN** item 2 is selected in the pane, the pane's focus is on item 6, and the user closes the pane and opens it again
- **THEN** no item is selected in the pane and its focus is on no item

#### Scenario: Clearing the Conversation Clears the Pane's State

- **WHEN** the pane is open, item 3 is selected and focused in it with its detail expanded, and the user runs `/clear`
- **THEN** the pane stays open and the view mode stays pane, with no item selected, focused, or expanded

### Requirement: The Pane's Focus Survives a Changing List

When the item the pane's focus is on leaves the list by anything other than the pane's own delete, such as a model update, a band delete, or `/todos delete`, the pane's focus SHALL move to the item now at the same position, or to the last item when the list is shorter. The pane's selection SHALL drop items that left the list.

#### Scenario: A Band Delete Under the Pane's Focus

- **WHEN** the list holds 5 items, the pane's focus is on item 3, and the user deletes item 3 from the band
- **THEN** the pane's focus is on the item that followed it, now item 3

### Requirement: The Pane Shows an Empty List

With no items on the list, the open pane SHALL show its `Todos` heading and a dim `No open items.`, and SHALL stay open. When items arrive, the pane SHALL show them.

#### Scenario: An Emptied List Keeps the Pane Open

- **WHEN** the pane is open and the user runs `/todos clear`
- **THEN** the pane stays open and shows `No open items.`

### Requirement: The Pane's Help Line

While the pane holds the keys, its help line SHALL name its keys as the band's help line does, naming `t band` in place of the band's `t pane`, naming `n/p page` only while the list holds more items than the window, and naming `o` as collapse while a detail is expanded. While it does not hold the keys, the help line SHALL name `Ctrl+X Tab` as the way to focus it.

#### Scenario: The Unfocused Pane Names the Focus Chord

- **WHEN** the pane is open and the prompt box holds the keys
- **THEN** the pane's help line names `Ctrl+X Tab`

#### Scenario: The Focused Pane Names the Band Key

- **WHEN** the pane holds the keys
- **THEN** the pane's help line names `t band` and does not name `t pane`
