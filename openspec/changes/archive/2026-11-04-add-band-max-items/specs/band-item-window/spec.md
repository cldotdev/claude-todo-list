## ADDED Requirements

### Requirement: A Setting Limits the Items in the Band

The plugin SHALL declare a `band_max_items` user setting, a number with the default 5, which `/config` shows as `todo-list.band_max_items`. Valid values SHALL be the integers 1 through 10. Any other number, a row holding a non-number, a missing row, or a list of rows that cannot be read SHALL count as the default. `/config` refuses a non-number, and the engine does not load the mod when one is stored in the settings file by hand. The band SHALL read the setting each time it draws. The setting SHALL NOT affect the pane. Scenarios of this capability that name a window of 10 items have `band_max_items` set to 10.

#### Scenario: The Default Shows 5 Items

- **WHEN** the list holds 25 items, `band_max_items` is not set, the band has 20 rows, and the band does not hold the focus
- **THEN** the band shows items 1 through 5 and `20 more`

#### Scenario: A Valid Value Sets the Window

- **WHEN** the list holds 25 items, `band_max_items` is 4, the band has 20 rows, and the band does not hold the focus
- **THEN** the band shows items 1 through 4 and `21 more`

#### Scenario: Both Ends of the Range Are Valid

- **WHEN** the list holds 25 items, the band has 20 rows, and `band_max_items` is 1 or 10
- **THEN** the band shows 1 item with `24 more`, or 10 items with `15 more`

#### Scenario: An Invalid Value Gives the Default

- **WHEN** the list holds 25 items, the band has 20 rows, and `band_max_items` is 0, -1, 11, or 3.5
- **THEN** the band shows items 1 through 5 and `20 more`

#### Scenario: A Row Holding a Non-Number Gives the Default

- **WHEN** the list holds 25 items, the band has 20 rows, and the settings list reports `band_max_items` as `"4"` or null
- **THEN** the band shows items 1 through 5 and `20 more`

#### Scenario: An Unreadable Setting Gives the Default

- **WHEN** the list holds 25 items, the band has 20 rows, and the list of settings cannot be read
- **THEN** the band shows items 1 through 5 and `20 more`

#### Scenario: A Short List Under the Setting Shows Whole

- **WHEN** the list holds 3 items, `band_max_items` is 4, and the band has 20 rows
- **THEN** the band shows all 3 items and no `more` line

#### Scenario: Paging Moves by the Setting

- **WHEN** the list holds 25 items, `band_max_items` is 4, the band has 20 rows, the window shows items 1 through 4, the focus is on item 2, and the user presses `n`
- **THEN** the window shows items 5 through 8 and the focus is on item 6

#### Scenario: A Squeezed Band Shows Fewer Than the Setting

- **WHEN** the list holds 25 items, `band_max_items` is 8, the band has 8 rows, every title and the help line fit on one row, and the band does not hold the focus
- **THEN** the band shows items 1 through 4 and `21 more`

#### Scenario: The Pane Ignores the Setting

- **WHEN** the list holds 25 items, `band_max_items` is 2, the pane has 40 body rows, and every title and the help line fit on one row
- **THEN** the pane shows all 25 items

## MODIFIED Requirements

### Requirement: The Band Shows a Window That Fits Its Rows

The band SHALL show its items as a window over the list. The window SHALL hold as many items as fit in the rows the engine gives the band, together with the band's other rows: the rule, the heading, the help line as wrapped, the `<n> more` line when items come after the window, and the extra rows of the focused item's wrapped title. The window SHALL hold at most `band_max_items` items, and at least 1 item while the list has any. When the whole list fits within those limits, the window SHALL hold the whole list. In list view the band SHALL NOT be taller than the rows the engine gives it, unless those rows cannot hold one item. Each item SHALL keep its list-wide number, the number `/todos delete`, `/todos restore`, and pasted quotes use. While the band does not hold the focus, the window SHALL start at the first item.

#### Scenario: A Long List Shows Its First 10 Items

- **WHEN** the list holds 25 items, the band has room for 10 items, and the band does not hold the focus
- **THEN** the band shows items 1 through 10, numbered 1 through 10

#### Scenario: Items Below the First Window Keep Their Numbers

- **WHEN** the list holds 25 items, the band has room for 10 items, and the window starts at item 11
- **THEN** the band shows items 11 through 20, numbered 11 through 20

#### Scenario: A Short List Shows Whole

- **WHEN** the list holds 7 items, `band_max_items` is 10, and the band has 20 rows
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
