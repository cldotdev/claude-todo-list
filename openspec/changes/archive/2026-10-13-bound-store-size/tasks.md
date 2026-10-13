## 1. Keys and Size

- [x] 1.1 In a new `hooks/store.ts`, add helpers that build `session:<id>:<updatedAt>:<size>` and parse a key into id, `updatedAt`, and size (taking the last two segments as the numbers), and that recognize a legacy `session:<id>` key
- [x] 1.2 Add the cap constant (4,194,304) and an 80% target, and a helper that computes the store's JSON length from parsed keys as `2 + Σ(JSON.stringify(key).length + 1 + size) + (count - 1)`
- [x] 1.3 Add a helper that, given parsed keys and the current session id, picks whole sessions to delete, oldest `updatedAt` first and never the current session, until the computed length is at or under the target

## 2. Saving

- [x] 2.1 Add `$.state` atoms for the current session's saved key and for whether the save-failure toast has been shown; add both to the `todo-list` state in `types/index.d.ts`
- [x] 2.2 Rewrite `persist()` to run on its own promise chain: with an empty list and trash, delete the session's saved key; otherwise set the new key and then delete the previous one, and record the new key in its atom
- [x] 2.3 On a `set` rejection whose text names the limit, run `keys()`, delete the sessions the helper picks, and try the save once more; do not retry any other rejection
- [x] 2.4 On a final failure, log it with `$.ui.log`, show one toast per session saying list changes are not being saved, and return without throwing

## 3. Session Start and Clear

- [x] 3.1 Rewrite the `session.start` sweep to call `keys()` once and act on the parsed names: migrate each legacy key (read it, delete it if invalid, otherwise save it under the new format with its stored `updatedAt` and delete the legacy key), delete keys older than `cleanupPeriodDays`, delete all but the newest key of each session, and delete sessions picked by the size helper when over the target
- [x] 3.2 Restore the current session from its newest key (a legacy entry newer than every new key wins), and record that key in the saved-key atom
- [x] 3.3 Make `/clear` (`session.end` with reason `clear`) delete every key of the session, legacy or new, and reset the saved-key atom

## 4. Tests

- [x] 4.1 Test that a save writes the new key format, replaces the previous key, deletes the key when the list and trash are empty, and that two concurrent saves leave one key holding the later list
- [x] 4.2 Test restore from the newest of duplicate keys and removal of the older ones, and that a newer legacy entry wins over new keys
- [x] 4.3 Test that the sweep expires keys by `cleanupPeriodDays` from the key name without reading the value, using the mock store
- [x] 4.4 Test size-based dropping: over 80% the oldest sessions go first, the current session is kept, and the sweep stops once at or under 80%; test the size helper against `JSON.stringify` of a mock store's contents
- [x] 4.5 Test the over-the-cap retry: a set rejected with the limit text frees room and succeeds on the retry; a set rejected for another reason is not retried
- [x] 4.6 Test the failure report: two failed saves show one toast, the band keeps the new list, and `/todos refresh` whose save fails does not reply that the list is unchanged
- [x] 4.7 Test legacy migration of valid and invalid entries, and that `/clear` deletes every key of the session
- [x] 4.8 Run `claude plugin validate .` and `claude plugin test .` and fix any failure
- [x] 4.9 Test that a migration refused for size frees room without dropping the current session, and pass the current session id, not the migrated one, to the retry

## 5. Documentation and Release

- [x] 5.1 Update How It Works in `README.md` and `README.zh-TW.md`: a saved list is also dropped, oldest first, when the saved lists near the store's size cap, and a toast says when changes cannot be saved
- [x] 5.2 Bump the minor version in `.claude-plugin/plugin.json`, unless `paginate-todo-band` has already bumped it for the same release
