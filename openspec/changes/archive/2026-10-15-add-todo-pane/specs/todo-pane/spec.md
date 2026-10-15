## Purpose

Shows the list in a pane whose height does not depend on the prompt box, with the band's keys, so the list can be read and worked while a long prompt squeezes the band.

## ADDED Requirements

### Requirement: The Pane Opens on Request

The pane SHALL open when the user presses `w` while the band holds the focus, or runs `/todos pane` with nothing after it. Neither SHALL do anything when the pane is already open. `/todos pane` followed by other text SHALL keep sending that text as a prompt with the items quoted, as `/todos <prompt>` does. The pane SHALL ask for the keys when it opens; it gets them only when the engine grants that, which it does not while the prompt box holds text or the band holds the focus.

#### Scenario: The Command Opens the Pane

- **WHEN** the pane is closed and the user runs `/todos pane`
- **THEN** the pane opens and shows the list, and the command replies `The Todos pane is open.`

#### Scenario: The Command Takes the Keys From an Empty Prompt

- **WHEN** the pane is closed, nothing else holds the focus, and the user runs `/todos pane`
- **THEN** the pane opens holding the keys

#### Scenario: W Opens the Pane Without the Keys

- **WHEN** the pane is closed, the band holds the focus, and the user presses `w`
- **THEN** the pane opens, and the band keeps the keys until the user moves them with `Ctrl+X Tab`

#### Scenario: Opening an Open Pane Does Nothing

- **WHEN** the pane is open, its focus is on item 4, and the user runs `/todos pane`
- **THEN** the pane stays open with its focus on item 4

#### Scenario: Text After Pane Still Goes Out as a Prompt

- **WHEN** the list holds 3 items and the user runs `/todos pane layout looks wrong`
- **THEN** the prompt `pane layout looks wrong` is sent with the 3 items quoted above it

### Requirement: The Pane Stays Open Until Closed

The pane SHALL stay open across turns, while the user types in the prompt box, and while it does not hold the keys. `Esc` SHALL hand the keys back to the prompt box and SHALL NOT close the pane. The pane SHALL close only through the engine's close, `Ctrl+X X` or its close mark. The pane SHALL NOT open on its own: not at session start, not after a resume, and not when the band is squeezed.

#### Scenario: Esc Keeps the Pane Open

- **WHEN** the pane holds the keys and the user presses `Esc`
- **THEN** the prompt box holds the keys and the pane is still open

#### Scenario: Starting a Session Does Not Open the Pane

- **WHEN** a session starts or is resumed with items on the list
- **THEN** the mod does not open the pane

#### Scenario: A Squeezed Band Does Not Open the Pane

- **WHEN** the pane is closed and the band's rows shrink so that its window holds 1 item
- **THEN** the mod does not open the pane

### Requirement: The Pane Shows a Window That Fits Its Rows

The pane SHALL show its items as a window over the list, holding as many items as fit in the pane's body rows together with its other rows: the heading, the help line as wrapped, the `<n> more` line when items come after the window, the extra rows of the focused item's wrapped title, and the expanded detail. The window SHALL have no 10-item cap and SHALL hold at least 1 item while the list has any. Each item SHALL keep its list-wide number. Under the window the pane SHALL show a dim `<n> more` line counting the items after it, absent when none come after it.

#### Scenario: A Tall Pane Shows More Than 10 Items

- **WHEN** the list holds 25 items, the pane has 40 body rows, and every title and the help line fit on one row
- **THEN** the pane shows all 25 items, numbered 1 through 25, and no `more` line

#### Scenario: A Short Pane Counts the Rest

- **WHEN** the list holds 25 items, the pane has 12 body rows, every title and the help line fit on one row, and no detail is expanded
- **THEN** the pane shows items 1 through 9 and `16 more`

### Requirement: The Pane Has the Band's Keys

While the pane holds the keys, `j`/`k` and `Tab`/`Shift+Tab` SHALL move its focus one item at a time, wrapping from the last item to the first and back, with the window moving the least distance that shows the focused item. `n`/`p` SHALL move the window by up to the number of items it holds, keeping the focus's row, and SHALL change nothing when the window cannot move or the whole list fits. `s` SHALL select or unselect the focused item, `a` SHALL select every item or clear the selection when every item is selected, `v` SHALL paste the selected items, or the focused item when none is selected, into the prompt box quoted with their numbers, `b` SHALL ask `/btw` about the focused item, and `d` SHALL arm a delete of the focused item that a second `d` confirms and `Esc` cancels. Each key SHALL act on the pane's own focus and selection, never the band's.

#### Scenario: J Moves the Pane's Focus

- **WHEN** the pane holds the keys, its focus is on item 2, and the user presses `j`
- **THEN** the pane's focus is on item 3

#### Scenario: Paging in a Short Pane

- **WHEN** the list holds 25 items, the pane's window holds 9 items and shows items 1 through 9, the pane's focus is on item 3, and the user presses `n`
- **THEN** the window shows items 10 through 18 and the pane's focus is on item 12

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

The pane SHALL keep its own focus, expanded detail, selection, armed delete, and window position, apart from the band's. The band's focus, selection, and leave rules SHALL NOT change the pane's state, and the pane's SHALL NOT change the band's. Typing in the prompt box, sending a prompt, and handing the keys back with `Esc` SHALL NOT reset the pane's focus, expanded detail, selection, or window. A paste that reaches the prompt box SHALL clear the pane's selection. Closing the pane, and clearing the conversation with `/clear`, SHALL clear all of the pane's state. While the pane does not hold the keys, its focus dot SHALL be drawn dim; when the pane takes the keys again, its focus SHALL be on the item it was on.

#### Scenario: Typing Keeps the Pane's Place

- **WHEN** the pane's focus is on item 15 with item 15's detail expanded, the user hands the keys back with `Esc`, types in the prompt box, and moves the keys back to the pane with `Ctrl+X Tab`
- **THEN** the pane's focus is on item 15 and item 15's detail is still expanded

#### Scenario: The Band's Leave Does Not Touch the Pane

- **WHEN** items 2 and 3 are selected in the pane, the band holds the focus, and the user leaves the band with `Esc`
- **THEN** items 2 and 3 are still selected in the pane

#### Scenario: A Paste Clears the Pane's Selection

- **WHEN** items 2 and 3 are selected in the pane, the user presses `v`, and the quote reaches the prompt box
- **THEN** no item is selected in the pane

#### Scenario: The Unfocused Pane Dims Its Dot

- **WHEN** the pane's focus is on item 4 and the prompt box holds the keys
- **THEN** the pane draws item 4's focus dot dim

#### Scenario: Closing Clears the Pane's State

- **WHEN** item 2 is selected in the pane, the pane's focus is on item 6, and the user closes the pane and opens it again
- **THEN** no item is selected in the pane and its focus is on no item

#### Scenario: Clearing the Conversation Clears the Pane's State

- **WHEN** the pane is open, item 3 is selected and focused in it with its detail expanded, and the user runs `/clear`
- **THEN** the pane stays open with no item selected, focused, or expanded

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

While the pane holds the keys, its help line SHALL name its keys as the band's help line does, naming `n/p page` only while the list holds more items than the window, and naming `o` as collapse while a detail is expanded. While it does not hold the keys, the help line SHALL name `Ctrl+X Tab` as the way to focus it.

#### Scenario: The Unfocused Pane Names the Focus Chord

- **WHEN** the pane is open and the prompt box holds the keys
- **THEN** the pane's help line names `Ctrl+X Tab`
