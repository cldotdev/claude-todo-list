## RENAMED Requirements

- FROM: `### Requirement: The Band Shows a 10-Item Window`
- TO: `### Requirement: The Band Shows a Window That Fits Its Rows`
- FROM: `### Requirement: The Help Line Names the Paging Keys on a Long List`
- TO: `### Requirement: The Help Line Names the Paging Keys When the List Does Not Fit`

## MODIFIED Requirements

### Requirement: The Band Shows a Window That Fits Its Rows

The band SHALL show its items as a window over the list. The window SHALL hold as many items as fit in the rows the engine gives the band, together with the band's other rows: the rule, the heading, the help line as wrapped, the `<n> more` line when items come after the window, and the extra rows of the focused item's wrapped title. The window SHALL hold at most 10 items, and at least 1 item while the list has any. When the whole list fits, the window SHALL hold the whole list. In list view the band SHALL NOT be taller than the rows the engine gives it, unless those rows cannot hold one item. Each item SHALL keep its list-wide number, the number `/todos delete`, `/todos restore`, and pasted quotes use. While the band does not hold the focus, the window SHALL start at the first item.

#### Scenario: A Long List Shows Its First 10 Items

- **WHEN** the list holds 25 items, the band has room for 10 items, and the band does not hold the focus
- **THEN** the band shows items 1 through 10, numbered 1 through 10

#### Scenario: Items Below the First Window Keep Their Numbers

- **WHEN** the list holds 25 items, the band has room for 10 items, and the window starts at item 11
- **THEN** the band shows items 11 through 20, numbered 11 through 20

#### Scenario: A Short List Shows Whole

- **WHEN** the list holds 7 items and the band has 20 rows
- **THEN** the band shows all 7 items

#### Scenario: A Squeezed Band Shows Fewer Items

- **WHEN** the list holds 25 items, the band has 8 rows, every title and the help line fit on one row, and the band does not hold the focus
- **THEN** the band shows items 1 through 4 and `21 more`, and the band is 8 rows tall

#### Scenario: A Squeezed Short List Is Windowed Too

- **WHEN** the list holds 7 items, the band has 8 rows, and every title and the help line fit on one row
- **THEN** the band shows items 1 through 4 and `3 more`

#### Scenario: A Wrapped Focused Title Takes a Row From the Window

- **WHEN** the list holds 25 items, the band has 8 rows, the help line fits on one row, and the focused item's title wraps to two rows
- **THEN** the band shows 3 items, including the focused one

#### Scenario: Too Few Rows Still Show One Item

- **WHEN** the list holds 25 items and the band has 3 rows
- **THEN** the band shows 1 item, and the engine scrolls the band

### Requirement: Paging Moves the Window and Keeps the Focus Row

While the band shows the list, `n` SHALL move the window down by up to the number of items the window holds and `p` SHALL move it up by up to that number. The window SHALL stay full: it SHALL NOT start before the first item or end after the last. The focus SHALL keep its row within the window, so the focused item moves by as many items as the window moved. When the window cannot move, or the whole list fits in the window, the key SHALL change nothing.

#### Scenario: Next Page Keeps the Focus Row

- **WHEN** the list holds 25 items, the band has room for 10 items, the window shows items 1 through 10, the focus is on item 5, and the user presses `n`
- **THEN** the window shows items 11 through 20 and the focus is on item 15

#### Scenario: Next Page Stops at the End

- **WHEN** the list holds 25 items, the band has room for 10 items, the window shows items 11 through 20, the focus is on item 15, and the user presses `n`
- **THEN** the window shows items 16 through 25 and the focus is on item 20

#### Scenario: Previous Page Stops at the Top

- **WHEN** the list holds 25 items, the band has room for 10 items, the window shows items 6 through 15, the focus is on item 8, and the user presses `p`
- **THEN** the window shows items 1 through 10 and the focus is on item 3

#### Scenario: A Squeezed Window Pages by What It Shows

- **WHEN** the list holds 25 items, the window holds 4 items and shows items 1 through 4, the focus is on item 2, and the user presses `n`
- **THEN** the window shows items 5 through 8 and the focus is on item 6

#### Scenario: Paging at the Edge Changes Nothing

- **WHEN** the list holds 25 items, the window shows items 1 through 10, and the user presses `p`
- **THEN** the window and the focus stay where they were

#### Scenario: A Short List Does Not Page

- **WHEN** the list holds 7 items, the whole list fits in the window, and the user presses `n`
- **THEN** the window and the focus stay where they were

### Requirement: The Help Line Names the Paging Keys When the List Does Not Fit

While the band holds the focus and shows the list, its help line SHALL name `n/p page` when the list holds more items than the window, and SHALL NOT name it otherwise. The help line SHALL name `v` for paste and `w` for the pane.

#### Scenario: A Long List Names the Paging Keys

- **WHEN** the list holds 11 items, the band has room for 10 items, and the band holds the focus
- **THEN** the help line names `n/p page`, `v paste`, and `w pane`

#### Scenario: A Squeezed Short List Names the Paging Keys

- **WHEN** the list holds 7 items, the window holds 4 items, and the band holds the focus
- **THEN** the help line names `n/p page`

#### Scenario: The Detail View Leaves Them Out

- **WHEN** the list holds 11 items and the band shows an item's detail
- **THEN** the help line does not name `n/p page`

#### Scenario: A Short List Leaves Them Out

- **WHEN** the list holds 10 items, the band has room for 10 items, and the band holds the focus
- **THEN** the help line names `v paste` and does not name `n/p page`

### Requirement: The Window Follows a Shrinking List

When the list shrinks, the window SHALL move up as far as needed to stay full, and to the first item once the whole list fits in the window.

#### Scenario: A Delete Near the End Pulls the Window Up

- **WHEN** the list holds 25 items, the band has room for 10 items, the window shows items 16 through 25, and the user deletes item 20
- **THEN** the list holds 24 items and the window shows items 15 through 24

## ADDED Requirements

### Requirement: The Window Follows the Band's Rows

When the rows the engine gives the band change, such as when the prompt box grows or shrinks, the window SHALL resize to fit them and SHALL keep the focused item in view.

#### Scenario: A Growing Prompt Shrinks the Window Around the Focus

- **WHEN** the list holds 25 items, the window shows items 1 through 10, the focus is on item 9, and the band's rows shrink so that the window holds 4 items
- **THEN** the window shows items 6 through 9 and the focus stays on item 9

### Requirement: The W Key Opens the Pane

While the band holds the focus, `w` SHALL open the todo pane, as the `todo-pane` capability describes. It SHALL NOT change the band's focus, selection, detail view, or window.

#### Scenario: W Opens the Pane From the Band

- **WHEN** the band holds the focus, the pane is closed, and the user presses `w`
- **THEN** the pane opens and the band keeps its focus on the same item
