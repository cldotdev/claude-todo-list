# Item Trash

## Purpose

Records every item that leaves the open items list, with who removed it, so a wrong removal can be seen and undone, and a deleted item is not added back.

## Requirements

### Requirement: Every Removal Goes to the Trash

Every item that leaves the list SHALL go to the trash with its title, its detail, its source, and the time it left. The source SHALL be `user` for the band's delete key, `/todos delete`, and `/todos clear`, and `model` for the per-turn update, the periodic review, and `/todos refresh`. A new entry SHALL replace an older entry with the same title.

#### Scenario: A Band Delete Is a User Removal

- **WHEN** the user deletes an item with the band's delete key
- **THEN** the trash holds that item's title and detail with the source `user`

#### Scenario: A Per-Turn Removal Is a Model Removal

- **WHEN** a per-turn update removes item 2
- **THEN** the trash holds item 2's title and detail with the source `model`

#### Scenario: A Repeated Title Keeps One Entry

- **WHEN** the model removes an item, the item is added back, and the user then deletes it
- **THEN** the trash holds one entry with that title, with the source `user`

### Requirement: Trash Caps per Source

The trash SHALL keep at most 99 entries from each source, dropping the oldest entry of that source first. Entries from one source SHALL NOT push out entries from the other.

#### Scenario: Model Removals Do Not Push Out User Deletions

- **WHEN** the trash holds 5 user entries and 99 model entries, and the model removes one more item
- **THEN** the oldest model entry is dropped and all 5 user entries remain

### Requirement: Removed Items Stay Off the List

The per-turn update, the periodic review, and `/todos refresh` SHALL be told which titles the user removed and which the model removed. An item whose title matches a user entry SHALL never be added to the list. The model SHALL be told not to add back an item it removed unless the conversation reopens it, and the mod SHALL NOT filter such items out itself.

#### Scenario: A User-Deleted Title Is Filtered Out

- **WHEN** a per-turn reply adds an item whose title matches a user entry in the trash
- **THEN** the list does not gain that item

#### Scenario: A Model-Removed Item Can Come Back

- **WHEN** a per-turn reply adds an item whose title matches a model entry in the trash
- **THEN** the list gains that item

### Requirement: Listing the Trash

`/todos trash` SHALL list the trash newest first under a `Trash` header, numbered from 1, each entry as a `<number>. <title> [<source>]` line with its detail lines indented under it, as `/todos` shows details; an entry without a detail has only its title line. With an empty trash it SHALL say the trash is empty. Any text after `trash` SHALL get a usage message, and nothing SHALL be sent to the model as a prompt.

#### Scenario: Listing Shows the Source

- **WHEN** the user deleted item A and then the model removed item B, and the user runs `/todos trash`
- **THEN** the reply is `Trash`, then `1. B [model]` with B's detail under it, then `2. A [user]` with A's detail under it

#### Scenario: An Empty Trash

- **WHEN** the user runs `/todos trash` with an empty trash
- **THEN** the reply says the trash is empty

#### Scenario: Extra Text Is Refused

- **WHEN** the user runs `/todos trash all`
- **THEN** the reply is a usage message and no prompt is sent

### Requirement: Restoring from the Trash

`/todos restore <numbers>` SHALL take numbers as `/todos trash` shows them, in the same forms `/todos delete` accepts (such as `2`, `1-3`, or `1,4 6`). Each restored entry SHALL leave the trash and its item SHALL be appended to the list with its title and detail; restoring a user entry lifts its never-add-back block. An entry whose title is already on the list SHALL leave the trash without adding a second item. The reply SHALL start with `Restored <count>:`, counting only the items added to the list, followed by one `<number>. <title>` line per picked entry, with ` (already on the list)` after a title that was already listed. A number past the end of the trash SHALL cancel the whole restore with `No trash entry <number>. Nothing was restored.`, and a missing or malformed number list SHALL get a usage message ending `Nothing was restored.`; in both cases nothing SHALL change and nothing SHALL be sent as a prompt.

#### Scenario: Restore Puts an Item Back

- **WHEN** the user runs `/todos restore 1` and entry 1 is a user entry
- **THEN** the item is last on the list with its title and detail, the entry is gone from the trash, and later replies may add that title again

#### Scenario: Restore Marks a Title Already on the List

- **WHEN** trash entries 1 and 2 are picked and entry 2's title is already on the list
- **THEN** only entry 1's item is added, both entries leave the trash, and the reply is `Restored 1 item:` followed by entry 1's line and entry 2's line ending ` (already on the list)`

#### Scenario: A Number past the Trash Cancels the Restore

- **WHEN** the trash holds 2 entries and the user runs `/todos restore 1,3`
- **THEN** nothing is restored and the reply is `No trash entry 3. Nothing was restored.`

#### Scenario: A Malformed Restore Is Refused

- **WHEN** the user runs `/todos restore` or `/todos restore two`
- **THEN** the reply is a usage message, nothing changes, and no prompt is sent

### Requirement: Purging from the Trash

`/todos purge <numbers>` SHALL take numbers as `/todos restore` does and remove the picked entries from the trash for good, without putting their items back on the list. Purging a user entry lifts its never-add-back block. The reply SHALL start with `Purged <count>:` followed by one `<number>. <title>` line per purged entry. A number past the end of the trash SHALL cancel the whole purge with `No trash entry <number>. Nothing was purged.`, and a missing or malformed number list SHALL get a usage message ending `Nothing was purged.`; in both cases nothing SHALL change and nothing SHALL be sent as a prompt.

#### Scenario: Purge Drops an Entry for Good

- **WHEN** the trash holds user entries B (1) and A (2) and the user runs `/todos purge 1`
- **THEN** the reply is `Purged 1 item:` then `1. B`, the list stays as it was, the trash holds only A, and a later reply may add B

#### Scenario: A Malformed or Out-of-Range Purge Is Refused

- **WHEN** the trash holds 2 entries and the user runs `/todos purge`, `/todos purge two`, or `/todos purge 1,3`
- **THEN** nothing changes, no prompt is sent, and the reply is a usage message or `No trash entry 3. Nothing was purged.`

### Requirement: Clear and Reset

`/todos clear` SHALL delete every item on the list as user removals. `/todos reset` SHALL empty both the list and the trash; any text after `reset` SHALL get a usage message, and nothing SHALL change or be sent as a prompt. Claude Code's `/clear` SHALL empty both, as it empties the list today. `/todos clear` and `/todos reset` SHALL take effect after any per-turn update, review, or refresh already queued or waiting for its reply, so such a reply cannot put items back on the list after them.

#### Scenario: Clear Moves Every Item to the Trash

- **WHEN** the list holds 3 items and the user runs `/todos clear`
- **THEN** the list is empty and the trash holds the 3 items as user entries

#### Scenario: Reset Empties the Trash

- **WHEN** the user runs `/todos reset`
- **THEN** the list and the trash are both empty, and a later reply may add any title

#### Scenario: Clear Waits for a Pending Reply

- **WHEN** a per-turn update is waiting for its reply, the user runs `/todos clear`, and the reply then adds an item
- **THEN** the list ends empty, and the added item is in the trash as a user entry

#### Scenario: Extra Text after Reset Is Refused

- **WHEN** the user runs `/todos reset now`
- **THEN** the reply is a usage message, the list and the trash stay as they were, and no prompt is sent

### Requirement: Saved Trash and Migration

The trash SHALL be saved with the session's list and restored when the session resumes, and a session's saved entry SHALL be deleted only when both the list and the trash are empty. A saved entry from an earlier version that holds a `done` list of titles SHALL load with each title as a user entry with an empty detail, and entries saved afterwards SHALL NOT hold `done`.

#### Scenario: The Trash Survives a Resume

- **WHEN** a session with 2 trash entries and an empty list is resumed
- **THEN** `/todos trash` lists the 2 entries

#### Scenario: An Old `done` List Migrates

- **WHEN** a session saved with `done: ["A"]` is resumed
- **THEN** the trash holds A as a user entry with an empty detail, and a reply adding A does not put it on the list
