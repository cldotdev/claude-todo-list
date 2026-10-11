# Stale Item Review

## Purpose

Keeps the open items list from collecting items that a later turn made moot, by reviewing the list against the recent turns and, on `/todos refresh`, against the whole conversation.

## Requirements

### Requirement: Periodic Review Trigger

The mod SHALL count the answered main-loop turns since the last review; subagent turns and aborted turns SHALL NOT count. After a counted turn's list update, the mod SHALL run a review when 8 turns have been counted, or when the list holds at least 6 items and at least 3 turns have been counted. When the list is empty at that point, the mod SHALL skip the review and still reset the count. Running a review, a `/todos refresh` that sends a request, `/todos reset`, and Claude Code's `/clear` SHALL reset the count to zero, whatever the outcome. A `/todos refresh` that fails before sending any request SHALL leave the count as it was.

#### Scenario: Eight Turns Trigger a Review on a Short List

- **WHEN** the eighth counted turn since the last review completes and the list holds 2 items
- **THEN** the mod runs a review after that turn's list update

#### Scenario: A Long List Triggers an Earlier Review

- **WHEN** the third counted turn since the last review completes and the list holds 6 items after that turn's update
- **THEN** the mod runs a review

#### Scenario: A Long List Waits for Three Turns

- **WHEN** the second counted turn since the last review completes and the list holds 10 items
- **THEN** the mod does not run a review

#### Scenario: Subagent and Aborted Turns Do Not Count

- **WHEN** seven counted turns, then a subagent turn and an aborted turn, complete since the last review on a 2-item list
- **THEN** the mod does not run a review

#### Scenario: An Empty List Skips the Review

- **WHEN** the eighth counted turn since the last review completes and the list is empty after that turn's update
- **THEN** the mod does not run a review, and the next counted turn is counted as the first

#### Scenario: A Refresh That Sends Nothing Keeps the Count

- **WHEN** seven counted turns complete on a 2-item list, `/todos refresh` fails without sending a request, and one more turn completes
- **THEN** the mod runs a review

#### Scenario: Refresh Resets the Count

- **WHEN** `/todos refresh` runs after seven counted turns, and then one more turn completes on a 2-item list
- **THEN** the mod does not run a review

### Requirement: Review Content and Effect

A review SHALL send Sonnet the current list, the titles the user removed, the titles the model removed, and each counted turn since the last review with its user message and final answer, each turn clipped to a per-turn limit. The review SHALL only remove items: an item the reply names leaves the list and goes to the trash as removed by the model. A review SHALL NOT add items. When the reply is missing, malformed, or names a number past the list, the list SHALL stay as it was.

#### Scenario: A Review Removes a Moot Item

- **WHEN** a review runs on a 3-item list and the reply names item 2
- **THEN** the list keeps items 1 and 3, and item 2 is in the trash as removed by the model

#### Scenario: A Review Cannot Add Items

- **WHEN** a review reply also carries new items
- **THEN** the list gains no items

#### Scenario: A Failed Review Keeps the List

- **WHEN** a review reply is unparseable or names item 4 of a 3-item list
- **THEN** the list and the trash stay as they were

#### Scenario: The Review Sees Every Turn Since the Last Review

- **WHEN** a review runs after 8 counted turns
- **THEN** the review request carries the user message and final answer of all 8 turns

### Requirement: Removals During a Review

An item the user deletes while a review or refresh is waiting for its reply SHALL stay deleted, and it SHALL stay in the trash as removed by the user. An item that reaches the list while a per-turn update, review, or refresh is waiting, such as one put back with `/todos restore`, SHALL stay on the list whatever the reply says, since the reply did not judge it.

#### Scenario: A Deletion Made While the Review Runs Wins

- **WHEN** the user deletes item 1 while a review is waiting, and the reply names item 1
- **THEN** item 1 stays off the list and its trash entry stays a user removal

#### Scenario: An Item Restored While the Review Runs Stays

- **WHEN** the user restores an item while a review is waiting, and the reply removes every item it was sent
- **THEN** the restored item stays on the list and is not in the trash

### Requirement: Refresh Reviews Each Item

`/todos refresh` SHALL fork the main conversation with the current numbered list, the titles the user removed, and the titles the model removed, and ask which items are no longer open, which open items are missing, and which kept items need a new detail. Items the reply removes SHALL go to the trash as removed by the model; items it adds SHALL be appended; an item it updates SHALL take the new detail and keep its title, even when the reply also carries a title for it; every other item SHALL keep its title and detail unchanged. When the reply is missing or malformed, names a number past the list, updates a number it also removes, updates one number twice, or gives an update a detail that is empty after tidying, the list SHALL stay as it was and the command SHALL report the failure.

#### Scenario: Refresh Keeps an Open Item Unchanged

- **WHEN** `/todos refresh` runs on a 3-item list and the reply removes item 3 and adds one item
- **THEN** items 1 and 2 keep their titles and details, item 3 is in the trash as removed by the model, and the new item is last

#### Scenario: Refresh Rewrites a Kept Item's Detail

- **WHEN** a refresh reply updates item 2 with a new detail and a different title
- **THEN** item 2 keeps its title and shows the new detail, and the trash gains no entry

#### Scenario: An Invalid Update Fails the Refresh

- **WHEN** a refresh reply both removes and updates item 2, updates item 2 twice, or updates item 2 with a blank detail
- **THEN** the list and the trash stay as they were and the command reports that the refresh failed

#### Scenario: Refresh Reports the Change

- **WHEN** a refresh removes 2 items and adds 1 to a 5-item list
- **THEN** the command reports that the list now holds 4 items

#### Scenario: A Failed Refresh Keeps the List

- **WHEN** the refresh reply is unparseable
- **THEN** the list and the trash stay as they were and the command reports that the refresh failed

### Requirement: Refresh from the Transcript

When the fork reports that the main conversation has nothing to fork, such as right after a resume, `/todos refresh` SHALL instead send the main conversation's model one request built from the session's transcript, with the same list, removed titles, instructions, and reply handling as the fork. The transcript SHALL carry each user message and each agent text, and each tool call with its tool name and its result clipped to a per-result limit; when the whole exceeds a total limit, the newest content SHALL be kept. A refresh answered this way SHALL say in its reply that it was built from the transcript without the prompt cache. When the transcript holds no messages, the refresh SHALL fail without sending a request and SHALL tell the user to send a message and try again.

#### Scenario: Refresh After a Resume Uses the Transcript

- **WHEN** a resumed session runs `/todos refresh` before the main conversation answers, and the transcript holds earlier messages
- **THEN** the mod sends the main conversation's model a request carrying those messages, applies the reply as a refresh, and the reply notes that it came from the transcript without the prompt cache

#### Scenario: A Long Tool Result Is Clipped

- **WHEN** the transcript holds a tool call whose result is longer than the per-result limit
- **THEN** the request carries the tool name and only a clipped part of that result

#### Scenario: A Long Transcript Keeps the Newest Content

- **WHEN** the transcript is longer than the total limit
- **THEN** the request carries the newest messages and leaves out the oldest

#### Scenario: An Empty Transcript Fails the Refresh

- **WHEN** the fork has nothing to fork and the transcript holds no messages
- **THEN** no request is sent, the list stays as it was, and the reply tells the user to send a message and try again
