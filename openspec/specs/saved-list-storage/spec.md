# Saved List Storage

## Purpose

Saves each session's list and trash so a resumed session gets them back, while keeping the mod's store under Claude Code's size cap and its startup cost independent of how many sessions are saved.

## Requirements

### Requirement: An Entry's Key Carries Its Update Time and Size

Each session's saved entry SHALL be stored under the key `session:<session id>:<update time>:<size>`, where the update time is the entry's `updatedAt` in milliseconds and the size is the length of the entry's value as JSON text. A session SHALL have one key after each successful save: a save SHALL write the new key and then remove the key it replaces.

#### Scenario: A Save Replaces the Session's Key

- **WHEN** a session saved under `session:a:1000:50` saves again at time 2000 with a value 60 characters long
- **THEN** the store holds `session:a:2000:60` and no longer holds `session:a:1000:50`

#### Scenario: Saves in One Session Do Not Interleave

- **WHEN** two saves of the same session start at once
- **THEN** they run one after the other, and the store ends with one key for that session holding the later list

### Requirement: A Resumed Session Finds Its Newest Entry

When a session starts, the mod SHALL restore the entry under the newest key for that session id, found from the key names, and SHALL remove any older keys for the same session.

#### Scenario: Duplicate Keys Resolve to the Newest

- **WHEN** a session starts and the store holds `session:a:1000:50` and `session:a:2000:60`
- **THEN** the list and trash come from `session:a:2000:60`, and `session:a:1000:50` is removed

### Requirement: The Startup Sweep Reads Key Names Only

The sweep at session start SHALL decide what to remove from the key names alone, without reading any entry's value except a legacy entry being migrated. It SHALL remove entries whose update time is older than `cleanupPeriodDays`, as before, and older duplicate keys of a session.

#### Scenario: An Expired Entry Is Removed Without Being Read

- **WHEN** `cleanupPeriodDays` is 30 and a key's update time is 31 days old
- **THEN** the sweep removes that key without reading its value

### Requirement: The Store Stays at or Under 80% of the Cap

The mod SHALL compute the store's size from the key names as the length of the whole store as JSON text, the measure Claude Code applies to its 4,194,304-character cap. When the sweep finds the size over 80% of the cap, it SHALL remove whole sessions, oldest update time first, until the size is at or under 80%. It SHALL NOT remove the current session.

#### Scenario: The Oldest Sessions Go First

- **WHEN** the store is over 80% of the cap and holds sessions updated 90, 60, and 10 days ago, and removing the oldest brings it to or under 80%
- **THEN** the sweep removes only the session updated 90 days ago

#### Scenario: The Current Session Is Kept

- **WHEN** the store is over 80% of the cap and the current session is the oldest
- **THEN** the sweep removes the next-oldest sessions instead

### Requirement: A Save Refused for Size Frees Room and Retries Once

When a save fails because the store would exceed the cap, the mod SHALL remove sessions as the sweep does, oldest update time first and never the current session, until the store is at or under 80% of the cap, and SHALL try the save once more.

#### Scenario: The Retry Succeeds

- **WHEN** a save fails with the over-the-cap error and removing old sessions frees enough room
- **THEN** the save is tried again and the store holds the session's new key

### Requirement: A Failed Save Is Reported

When a save still fails, after the retry or for any other error, the mod SHALL show a toast saying the list changes are not being saved, at most once per session, and SHALL log the failure. The list shown in the band SHALL stay as it is. `/todos refresh` SHALL NOT say the list is unchanged when the list did change and only the save failed.

#### Scenario: Repeated Failures Toast Once

- **WHEN** two saves in the same session fail
- **THEN** one toast is shown

#### Scenario: Refresh Reports a Changed List Whose Save Failed

- **WHEN** `/todos refresh` changes the list and the save fails
- **THEN** the reply does not say the list is unchanged

### Requirement: Legacy Entries Are Migrated

An entry under the legacy key `session:<session id>` SHALL be read once, saved under the new key format, and removed from its legacy key. A legacy entry with an invalid value, or one older than `cleanupPeriodDays`, SHALL be removed. When a session has both a legacy key and new keys, the entry with the newest `updatedAt` SHALL win, and a legacy entry that does not win SHALL be removed. A legacy entry whose save fails SHALL stay under its legacy key until a later session start migrates it.

#### Scenario: A Legacy Entry Moves to the New Key

- **WHEN** a session starts and the store holds a valid entry under `session:a` with `updatedAt` 1000 and a value 50 characters long
- **THEN** the store holds `session:a:1000:50` and no longer holds `session:a`

#### Scenario: An Invalid Legacy Entry Is Removed

- **WHEN** a session starts and the store holds an invalid value under `session:a`
- **THEN** the store no longer holds `session:a`

#### Scenario: An Older Legacy Entry Is Removed

- **WHEN** a session starts and the store holds `session:a` with `updatedAt` 1000 and `session:a:2000:60`
- **THEN** the store holds `session:a:2000:60` and no longer holds `session:a`

#### Scenario: A Migration Refused for Size Spares the Current Session

- **WHEN** session `s1` starts, its key is the oldest in a store over 80% of the cap, and saving a legacy entry of another session is refused for size
- **THEN** room is freed from the other sessions, `s1`'s key stays, and the legacy entry is saved under the new key format

### Requirement: Clearing a Session Removes All Its Keys

Claude Code's `/clear` SHALL remove every key of the session, legacy or new. A save already running at the `/clear` SHALL finish before the keys are removed, so no key of the session is written afterwards.

#### Scenario: Clear Removes Duplicate Keys

- **WHEN** the store holds `session:a:1000:50` and `session:a:2000:60` and session `a` runs `/clear`
- **THEN** the store holds no key for session `a`

#### Scenario: A Save Running at Clear Does Not Bring a Key Back

- **WHEN** a save of session `a` is still writing its key as session `a` runs `/clear`
- **THEN** the `/clear` waits for the save, and afterwards the store holds no key for session `a`

### Requirement: An In-Process Resume Switches to the Resumed Session's Entry

When `/resume` switches the running process to another session, which raises `session.end` with the reason `resume` for the ending session and no second `session.start`, the mod SHALL empty the in-memory list, trash, review window, pending turns, and pane state of the ending session, without deleting any of its store keys. A save already running at that point SHALL finish under the ending session first. The mod SHALL load the resumed session's newest entry only once `$.session.id()` differs from the ending session's id, and only once, however many hooks ask for it, before any `/todos` command, prompt submit, or turn completion acts on the list. Until the id differs, the mod SHALL load nothing. No save SHALL write the ending session's list under the resumed session's id. A turn whose list update was still being applied at the resume SHALL be dropped.

#### Scenario: Resume Loads the Resumed Session's List and Trash

- **WHEN** session `s1` started with nothing saved, the user runs `/resume`, and the resumed session `s2` has a saved list of 1 item and 1 trash entry
- **THEN** `/todos` lists `s2`'s item and `/todos trash` lists its trash entry

#### Scenario: Resume Does Not Write the Old List Under the New Id

- **WHEN** session `s1` holds a saved list, the user runs `/resume` to session `s2` with nothing saved, and a turn then adds an item
- **THEN** the list holds only that item, `s1`'s key is unchanged, and the only new key is `s2`'s

#### Scenario: Nothing Loads Before the Id Switches

- **WHEN** the resume has ended `s1` but `$.session.id()` still answers `s1`
- **THEN** the mod loads nothing and keeps waiting for the switch

#### Scenario: A Turn Being Applied at Resume Is Dropped

- **WHEN** a turn's reply is still being applied as the user runs `/resume`
- **THEN** its items are not added to the list of the resumed session
