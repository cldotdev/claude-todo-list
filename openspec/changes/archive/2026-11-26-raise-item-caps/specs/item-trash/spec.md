## MODIFIED Requirements

### Requirement: Trash Caps per Source

The trash SHALL keep at most 999 entries from the `user` source, as many as the list holds, and at most 99 entries from the `model` source, dropping the oldest entry of that source first. Entries from one source SHALL NOT push out entries from the other.

#### Scenario: Model Removals Do Not Push Out User Deletions

- **WHEN** the trash holds 5 user entries and 99 model entries, and the model removes one more item
- **THEN** the oldest model entry is dropped and all 5 user entries remain

#### Scenario: User Deletions Stay Past the Model's Cap

- **WHEN** the list holds 104 items and the user runs `/todos clear`
- **THEN** the trash holds all 104 items as user entries, and `/todos restore 1-104` puts them all back on the list

### Requirement: Restoring from the Trash

`/todos restore <numbers>` SHALL take numbers as `/todos trash` shows them, in the same forms `/todos delete` accepts (such as `2`, `1-3`, or `1,4 6`). Each restored entry SHALL leave the trash and its item SHALL be appended to the list with its title and detail; restoring a user entry lifts its never-add-back block. An entry whose title is already on the list SHALL leave the trash without adding a second item. The reply SHALL start with `Restored <count>:`, counting only the items added to the list, followed by one `<number>. <title>` line per picked entry, with a space and `(already on the list)` after a title that was already listed. A number past the end of the trash SHALL cancel the whole restore with `No trash entry <number>. Nothing was restored.`, and a missing or malformed number list SHALL get a usage message ending `Nothing was restored.`. When the picked entries whose titles are not on the list outnumber the items the list has room for under its cap, the whole restore SHALL be cancelled with `The list has room for <count>, but the restore needs <number>. Nothing was restored.`, where `<count>` is the room as `1 item` or `<n> items`. In each of these cases nothing SHALL change and nothing SHALL be sent as a prompt.

#### Scenario: Restore Puts an Item Back

- **WHEN** the user runs `/todos restore 1` and entry 1 is a user entry
- **THEN** the item is last on the list with its title and detail, the entry is gone from the trash, and later replies may add that title again

#### Scenario: Restore Marks a Title Already on the List

- **WHEN** trash entries 1 and 2 are picked and entry 2's title is already on the list
- **THEN** only entry 1's item is added, both entries leave the trash, and the reply is `Restored 1 item:` followed by entry 1's line and entry 2's line ending `(already on the list)`

#### Scenario: A Number past the Trash Cancels the Restore

- **WHEN** the trash holds 2 entries and the user runs `/todos restore 1,3`
- **THEN** nothing is restored and the reply is `No trash entry 3. Nothing was restored.`

#### Scenario: A Malformed Restore Is Refused

- **WHEN** the user runs `/todos restore` or `/todos restore two`
- **THEN** the reply is a usage message, nothing changes, and no prompt is sent

#### Scenario: A Restore the List Has No Room for Is Cancelled

- **WHEN** the list holds 998 items, the trash holds 2 entries whose titles are not on the list, and the user runs `/todos restore 1-2`
- **THEN** the reply is `The list has room for 1 item, but the restore needs 2. Nothing was restored.`, and the list and the trash stay as they were

#### Scenario: An Entry Already on the List Needs No Room

- **WHEN** the list holds 999 items and the user restores a trash entry whose title is already on the list
- **THEN** the entry leaves the trash and the reply is `Restored 0 items:` followed by the entry's line, marked as already on the list
