## Context

See proposal.md (Why). The mod keeps its list in `$.state` atoms and saves it per session in `$.store` as `{ items, done, updatedAt }`. Finished turns queue in the `pending` atom and run one at a time through `enqueue`, each as one Sonnet `$.model.complete` call whose reply is a `{"remove":[...],"add":[...]}` change applied by `applyChanges` against the list it was sent. `applyList` then drops titles in `done`, so a user's delete made while the model was thinking wins. `/todos refresh` calls `$.model.fork` and parses a whole new list with `parseItems`. On `session.start`, the mod deletes every saved entry that `isStored` rejects or that has expired.

## Goals / Non-Goals

**Goals:**

- Every turn falls inside some review's window, so a turn that makes an item moot is seen by at least one review after the item exists.
- Every removal path records into the trash with the same rule, so the trash is the one place to find what left the list.

**Non-Goals:**

- Changing a kept item's title. Titles are the identity the band state, the trash recording, and the user filter rely on, so only remove and add change which titles are listed.
- Rewriting details outside refresh. The per-turn update and the periodic review cannot update items.
- Showing the trash in the band. The trash is reachable only through `/todos trash` and `/todos restore`.
- Making N, K, M, or the per-turn clip configurable.

## Decisions

### The Review Window Lives in `$.state`, Beside `pending`

A new atom holds the turns tried since the last review, each as `{ userText, answer }`; its length is the count the trigger reads. It sits in `$.state`, not the store, for the reason `pending` does: it survives a hot reload but needs no persistence, since a resumed session simply starts a new window. Alternative: persist it with the list. Rejected because the window can hold up to 8 clipped turns, far larger than the list, and losing it on resume costs only a later review.

### The Trigger Runs After Each Turn's Update, on the Same Queue

`runPending` appends each turn to the window once its incremental update has been tried, whatever the outcome, since a turn whose update failed is the one a review most needs to see. It then checks the trigger against the updated list length: run when the window holds 8 turns, or when it holds at least 3 and the list holds at least 6 items. An empty list skips the call and empties the window, since there is nothing to remove. The review runs inside the same queued job, so it never races an incremental update, and it is sent the list after that turn's update.

### A Review Is Tried Once

The window empties when a review starts, whatever its outcome, as a turn leaves `pending` once tried. Alternative: keep the window after a failure so the next turn retries. Rejected because a review that keeps failing would retry on every turn with a growing window; a missed review only delays cleanup until the next window or a `/todos refresh`.

### Constants

N = 8, K = 6, and M = 3 follow from the discussion: in the session that prompted this change, about 11 turns a day give one or two reviews a day, and a list that reaches 6 items gets reviewed within 3 turns. Each turn in the window is clipped to 20,000 characters, keeping its tail as `clip` does; 8 turns of user message and answer stay within a Sonnet request. All four are estimates.

### Review Reply Reuses the Change Format with `add` Dropped

The review asks for `{"remove":[...]}` and parses it with the same number validation as `applyChanges`, ignoring any `add` the reply carries. Alternative: a separate parser. Rejected because the numbering, validation, and failure rules are the same; only the add half is discarded.

### Refresh Becomes a Change over the Current List

`refreshPrompt` gains the numbered current list and the two removed-title blocks, and asks for the per-turn `{"remove","add"}` change plus an `update` list of `{ number, detail }` entries. The reply goes through the same number validation against the list sent; an `update` number that is out of range, also removed, or repeated, or a detail that is empty after tidying, fails the whole reply, and a `title` inside an update entry is ignored. An updated detail goes through the same tidying and length cap as any detail. Alternative: keep regenerating the list and diff old and new titles. Rejected because the model rewords titles, so a diff by title reports kept items as removed and the trash fills with items still on the list. `parseItems` and `LIST_FORMAT` lose their only caller and go.

### Only Refresh Can Update, and Only the Detail

A detail-only update keeps the title, so the band's focus, selection, armed delete, and the trash recording by title all stay correct, and the regenerating refresh's one benefit, fresh details on kept items, survives. Alternative: let `update` change titles. Rejected because every title-keyed piece of state would need an explicit old-to-new mapping, and a new title matching a user entry would turn the update into an unrecorded deletion. Alternative: offer `update` to the per-turn update too. Rejected because the model would likely touch details on most turns, defeating `applyList`'s skip when nothing changed, so the band would redraw and the store would be rewritten every turn.

### The Trash Is Recorded in One Place

`applyList` already sees the list before and after every model change. It records every title that was on the list and is not on the next list as a `model` entry, skipping titles that already hold a `user` entry (the user deleted them while the model was thinking). `tick` records `user` entries for the band's delete, `/todos delete`, and `/todos clear`. Recording by title works because the change format keeps kept items' titles unchanged.

### Refresh Falls Back to the Transcript

`$.model.fork` replays the main thread's last request in this process, so it has nothing to send after a resume until the main conversation answers once. On `nothing-to-fork`, refresh reads `$.session.messages()` and sends the same refresh prompt through `$.model.complete` on `$.session.model()`, with the transcript rendered as text before it: each user message, each agent text, and each tool call as its tool name with its result's `text` clipped to 2,000 characters. The rendered transcript is held to 200,000 characters, keeping the newest messages. Both limits are estimates; the API offers no token count, and CJK text costs more tokens per character than English. The review window is emptied only once a fork or fallback request is sent, so a refresh that sends nothing does not cost the next review its turns.

Alternatives: Sonnet for the fallback, rejected because refresh exists to have the stronger main-conversation model judge the whole conversation; text only without tool results, rejected by the user in favor of clipped results, which keep work that shows up only in tool output; an opt-in subcommand, rejected in favor of running automatically and noting in the reply that the request had no prompt cache.

### A Reply Judges Only the List It Was Sent

`applyList` receives the list each request was sent alongside the parsed reply. Items on the current list whose titles were not in the sent list reached it while the request waited (only `/todos restore` adds items outside the queue), so they are appended to the reply's list instead of being dropped. Alternative: run `restore` on the queue as well. Rejected because a restore would then wait behind a slow model call, while keeping unjudged items costs one set lookup.

### Clear and Reset Run on the Queue

`/todos clear` and `/todos reset` run inside `enqueue`, after any queued or in-flight model job. Alternative: run them at once and let `generation` discard stale replies, as Claude Code's `/clear` does. Rejected because `/todos clear` must record what it deletes, including items a waiting reply is about to add, and bumping `generation` would also drop the review window and queued turns that the user did not ask to discard.

### Trash Shape and Caps

Each entry is `{ title, detail, by: 'user' | 'model', at }`, with `at` from `$.clock.now()`. Adding an entry first removes any entry with the same title, then appends, then trims each source to its 99 newest entries. `/todos trash` numbers entries newest first, so `/todos restore 1` takes back the latest removal.

### Two Blocks in the Prompts

The prompts replace the single removed-items block with two: titles the user removed ("never add them back") and titles the model removed ("do not add them back unless the conversation reopens them"). Only user titles are filtered in `applyList`. Alternative: filter model titles too. Rejected because an item the conversation reopens has to be able to come back.

### Saved Format

Entries are saved as `{ items, trash, updatedAt }`. `isStored` accepts an entry that holds either `trash` or a legacy `done`; a legacy entry loads with each `done` title as a `user` entry with an empty detail and `at` set to the entry's `updatedAt`. Entries are written without `done`. The session's entry is deleted when both the list and the trash are empty, as it is today when both the list and `done` are empty.

### Subcommand Parsing

`trash`, `restore`, `purge`, and `reset` join `refresh`, `clear`, and `delete`. `restore` and `purge` share one helper that parses numbers against the trash with `parseNumbers`, with usage and missing-number messages shaped like `delete`'s but naming trash entries and ending `Nothing was restored.` or `Nothing was purged.`. As with `delete`, any argument led by one of these words is treated as that subcommand, so a malformed one is refused instead of being sent as a prompt. The command's `argumentHint` and description list the new subcommands.

## Risks / Trade-Offs

- [Refresh anchored on the current list may keep stale items it would have dropped when regenerating] → The prompt asks the model to judge each item from the conversation's end state and keep it only when it is still open. tasks.md includes a replay of the dev:cleanbot-spec:#tabla transcript that compares the anchored refresh with the regenerating one.
- [A kept item's detail goes stale between refreshes] → The per-turn update never rewrites details today either; `/todos refresh` rewrites them on demand.
- [The fallback sends the whole clipped transcript without the prompt cache, so it costs far more than a fork] → It runs only when a fork is impossible, and its reply says so.
- [`$.session.messages()` after a resume is documented as the transcript so far, but whether it holds the messages from before the resume was not verified] → If it does not, the transcript is empty and the refresh fails with the send-a-message hint, as it does today.
- [Downgrading to an older version deletes every saved list] → Accepted. See proposal.md (What Changes).
- [N, K, M, and the per-turn clip are estimates] → They are constants in one place, so tuning them is a one-line change.
- [Trash numbers shift when a removal lands between `/todos trash` and `/todos restore`] → The restore reply names each restored title, so a wrong pick shows at once and can be deleted again.
- [A review adds one Sonnet call with up to 8 turns of input] → The triggers allow at most one review every 3 turns.

## Migration Plan

The migration runs in place on load: a legacy entry gains a trash built from `done`, and the next save writes the new shape. Rolling back to the previous version deletes every entry saved in the new shape on its next session start; the list itself is not recoverable after that.
