## 1. State and Storage

- [x] 1.1 In `types/index.d.ts`, add a `TrashEntry` type (`title`, `detail`, `by: 'user' | 'model'`, `at`) and a review-window turn type; replace `done` with `trash` in `TodoListState` and `PluginState`, and add the review window to `PluginState`
- [x] 1.2 In `hooks/register.tsx`, replace the `done` atom with a `trash` atom and add a review-window atom; add one helper that records entries (replacing a same-title entry, appending, trimming each source to 99) and use it from `tick`
- [x] 1.3 Save `{ items, trash, updatedAt }`, delete the session's entry only when both the list and the trash are empty, and make `isStored` accept an entry holding either `trash` or a legacy `done`
- [x] 1.4 Load a legacy entry by turning each `done` title into a `user` entry with an empty detail and `at` set to the entry's `updatedAt`
- [x] 1.5 Make Claude Code's `/clear` (`session.end` with reason `clear`) empty the trash and the review window as well

## 2. Prompts and Parsing

- [x] 2.1 In `hooks/list.ts`, replace `removedBlock` with two blocks, titles the user removed (never add back) and titles the model removed (do not add back unless the conversation reopens them), and pass both to `incrementalPrompt`
- [x] 2.2 Add the review system prompt and `reviewPrompt` (current numbered list, both removed blocks, each window turn's user message and final answer clipped to 20,000 characters keeping the tail), asking for `{"remove":[...]}` and telling the model to judge each item from the end of the window
- [x] 2.3 Add a review reply parser that validates numbers as `applyChanges` does and ignores any `add`, and a refresh reply parser that also applies `update` entries (failing on a number that is out of range, removed, or repeated, or on a detail that is empty after tidying; ignoring any `title`; tidying and capping the detail); share the validation with `applyChanges` rather than duplicating it
- [x] 2.4 Change `refreshPrompt` to take the current list and the trash, ask for the `{"remove","add"}` change format plus an `update` list of `{ number, detail }` entries for kept items whose detail is out of date or empty, and tell the model to keep an item only when the conversation shows it is still open; remove `parseItems` and `LIST_FORMAT` once nothing calls them

## 3. Review and Refresh

- [x] 3.1 In `applyList`, filter titles that hold a `user` entry, and record every title that leaves the list as a `model` entry unless it already holds a `user` entry
- [x] 3.2 In `runPending`, append each turn to the review window once its incremental update has been tried, whatever the outcome, then run a review when the window holds 8 turns, or at least 3 turns with at least 6 items on the list; empty the window when the review starts, and skip the call (still emptying the window) when the list is empty
- [x] 3.3 Implement the review as a Sonnet `$.model.complete` call on the same queue, applying its removals through `applyList` and leaving the list unchanged on a missing, malformed, or out-of-range reply
- [x] 3.4 Make `/todos refresh` send the current list and trash, apply the reply through the refresh parser against the list sent, empty the review window, and keep its existing success and failure messages

- [x] 3.5 In `/todos refresh`, empty the review window only once a fork or fallback request is sent
- [x] 3.6 On `nothing-to-fork`, fall back to the transcript: render `$.session.messages()` as text (user messages, agent text, each tool call's name with its result `text` clipped to 2,000 characters, the whole held to 200,000 characters keeping the newest), send the refresh prompt after it through `$.model.complete` on `$.session.model()`, apply the reply as a refresh, and note in the success reply that it came from the transcript without the prompt cache; with an empty transcript, fail without a request and tell the user to send a message and try again

## 4. Commands

- [x] 4.1 Make `/todos clear` delete every item through `tick`, so they go to the trash as `user` entries
- [x] 4.2 Add `/todos trash`: list entries newest first, numbered, each with its title, source, and detail lines indented as `/todos` shows them; say the trash is empty when it is; refuse extra text with a usage message
- [x] 4.3 Add `/todos restore <numbers>`: parse with `parseNumbers` against the trash in `/todos trash` order, refuse a malformed list and cancel on a missing number with the same messages as `delete`, append restored items to the list (skipping titles already on it), remove their entries, and name each restored title in the reply
- [x] 4.4 Add `/todos reset`: empty the list, the trash, and the review window, and save
- [x] 4.5 Route any argument led by `trash`, `restore`, or `reset` to its subcommand so a malformed one is never sent as a prompt; update the command's `description` and `argumentHint`
- [x] 4.6 Run `/todos clear` and `/todos reset` inside `enqueue`, and keep items that reached the list after a model request was sent (`applyList` takes the sent list)
- [x] 4.7 Add `/todos purge <numbers>`: pick entries as `restore` does (sharing its number parsing and messages), remove them from the trash for good without touching the list, reply `Purged <count>:` with one line per entry, and list it in the command's `description` and `argumentHint`

## 5. Tests

- [x] 5.1 In `tests/todo-list.test.ts`, update the existing `done` tests (delete recording, stored entries, string-item migration) to the trash, and add a test that a legacy `done` entry migrates and its titles stay off the list
- [x] 5.2 Add tests for the review trigger: 8 turns on a short list, 3 turns on a 6-item list, no review at 2 turns on a long list, no review on an empty list, subagent and aborted turns not counted, refresh and `/todos reset` resetting the count
- [x] 5.3 Add tests for the review effect: removals go to the trash as `model`, added items are ignored, a malformed or out-of-range reply keeps the list, the request carries every window turn, and a delete made while the review waits stays a `user` entry
- [x] 5.4 Add tests for refresh through a `model.fork` mock: kept items keep title and detail, an update rewrites only the detail (a title in the entry is ignored), removals go to the trash as `model`, additions are appended, and a malformed reply or an invalid update (a removed or repeated number, or a blank detail) keeps the list and reports the failure
- [x] 5.5 Add tests for the trash: per-source caps, same-title replacement, user titles filtered and model titles allowed back, and the trash surviving a resume with an empty list
- [x] 5.6 Add tests for `/todos trash`, `/todos restore` (restore, skip a title already listed, cancel on a missing number, refuse malformed input without sending a prompt, lift a user block), `/todos clear`, and `/todos reset`
- [x] 5.7 Add tests for an item restored while a review waits staying on the list, and for `/todos clear` emptying the list after a pending per-turn reply adds an item; the test for a restore that marks a title already on the list should check the reply lines
- [x] 5.8 Add tests for `/todos purge`: an entry dropped for good with the user block lifted, and malformed or out-of-range input changing nothing and sending nothing
- [x] 5.9 Add tests (mocking `session.messages` and `session.model`) for the transcript fallback: a reply applied after `nothing-to-fork` with the transcript note, a long tool result clipped, a long transcript keeping the newest messages, an empty transcript failing without a request, and the review count kept by a refresh that sends nothing and reset by one that does
- [x] 5.10 Run `claude plugin validate .` and `claude plugin test .` and make both pass. A saved entry is not checked for the absence of `done`: `mock.store` exposes no writes, so the legacy-load and resume tests cover the format instead

## 6. Documentation

- [x] 6.1 Update `README.md`: How It Works (the periodic review and its triggers, the trash and the two never-add-back rules, refresh as a per-item review), the cost note, and the `/todos` command table (`trash`, `restore`, `clear`, `reset`, `refresh`)
- [x] 6.2 Make the same changes in `README.zh-TW.md`
- [x] 6.3 In both READMEs, note that `/todos refresh` right after a resume rebuilds from the transcript on the main model without the prompt cache

## 7. Validation

- [ ] 7.1 With a scratch script outside the repository, rebuild the open items list the per-turn update would have built over the dev:cleanbot-spec:#tabla transcript (`~/.claude/projects/-home-cl-work-choreslamour-cleanbot-spec/e7f15db9-ac24-4ec3-b214-e6bd3bf5669b.jsonl`), then run the old regenerating refresh prompt and the new anchored refresh prompt against that session with `claude -p --resume e7f15db9-ac24-4ec3-b214-e6bd3bf5669b --fork-session`, so each runs on the session's own context without appending to its transcript, and report which items each kept and dropped; delete the script afterwards. This costs about 10 Sonnet calls and 2 main-model calls with the full context. Not run: the user deferred it at archive time
