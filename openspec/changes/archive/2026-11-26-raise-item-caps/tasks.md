## 1. Tests First

- [x] 1.1 In `hooks/list.ts`, export `MAX_ITEMS` and give `MAX_TRASH` one cap per source, with all three values still 99; in `hooks/register.tsx`, make `capTrash` read the cap of each entry's source. No behavior changes yet
- [x] 1.2 In `tests/todo-list.test.ts`, add a test for each scenario of the `item-list-cap` spec, built from the exported constants rather than literals
- [x] 1.3 Add a test for the `User Deletions Stay Past the Model's Cap` scenario, and update the existing trash-cap test to the `model` cap
- [x] 1.4 Add tests for the `A Restore the List Has No Room for Is Cancelled` and `An Entry Already on the List Needs No Room` scenarios, checking that the list and the trash are unchanged after the cancelled restore
- [x] 1.5 Record the reply cap of each request in the model mock, and add a test that a review asks for as many reply tokens as a per-turn update
- [x] 1.6 Run `claude plugin test .` with the caps still at 99 and no other behavior change, and confirm that each new test of changed behavior fails for the reason it names, and that the full-list test, which pins existing behavior, passes

## 2. Caps, Restore, and Request Limits

- [x] 2.1 In `hooks/list.ts`, set `MAX_ITEMS` to 999, the `user` trash cap to `MAX_ITEMS`, and leave the `model` trash cap at 99
- [x] 2.2 In `hooks/register.tsx`, make `/todos restore` count the picked entries whose titles are not on the list and cancel with the spec's message, before changing the list or the trash, when they outnumber the list's room
- [x] 2.3 Give the per-turn update, the review, and the refresh from the transcript one named reply cap of 8,192 tokens
- [x] 2.4 Set `COMPLETE_TIMEOUT_MS` to 120 seconds

## 3. Documentation

- [x] 3.1 In `README.md` and `README.zh-TW.md`, state the list's 999-item cap in "How It Works", with one sentence saying each update sends the whole list to the model, so on a model with a smaller context window a very long list can stop updating before the cap; name no provider or model version
- [x] 3.2 In both READMEs, change the Trash bullet to the newest 999 the user removed and the newest 99 the model removed
- [x] 3.3 In both READMEs, say in the `/todos restore` row that a restore the list has no room for is cancelled whole

## 4. Verification

- [x] 4.1 Run `claude plugin validate --strict .` and `claude plugin test .`. The validation passes. On the installed Claude Code 2.1.332 the tests end at 137 pass and 53 fail; the same 53 tests fail on the unchanged code, 52 of them with `no implementation for ui.focus`, and all 7 tests this change adds or edits pass
- [x] 4.2 Run the type check CI runs, `npx -y -p typescript@7.0.2 tsc --noEmit -p .`, and confirm it passes
- [x] 4.3 Run `scripts/test-min-version.sh`, and confirm it passes
