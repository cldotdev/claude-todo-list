## 1. Tests First

- [x] 1.1 In `hooks/list.ts`, export `DEFAULT_BAND_ITEMS` (5) and `MAX_BAND_ITEMS` (10) beside `WINDOW_SIZE`, with no other change, so tests can import them
- [x] 1.2 In `tests/todo-list.test.ts`, add a `band_max_items` row fixture beside `defaultViewRow` and `languageRow`, with `kind: 'number'`
- [x] 1.3 Add band tests for each scenario of the `A Setting Limits the Items in the Band` requirement, mounting the band with the row stubbed through `config.list`, using the constants above rather than literals where they apply
- [x] 1.4 Run `claude plugin test .` on the otherwise unchanged code and confirm the new tests that specify changed behavior fail because the window still holds 10 items

## 2. Setting and Band

- [x] 2.1 In `.claude-plugin/plugin.json`, add the `band_max_items` field to `userConfig` with `"type": "number"`, `"default": 5`, a title, and a description naming the range and the fallback, without `min` or `max`
- [x] 2.2 In `hooks/list.ts`, add a pure helper that returns its `unknown` argument when it is an integer from 1 through `MAX_BAND_ITEMS`, otherwise `DEFAULT_BAND_ITEMS`, and remove `WINDOW_SIZE`
- [x] 2.3 In `hooks/register.tsx`, add a key constant beside `LANGUAGE_KEY` and a read helper shaped like `defaultView` that falls back to the default when the read throws
- [x] 2.4 Read the setting in the `AbovePrompt` render and use it for `isWhole` and `cap`; use `DEFAULT_BAND_ITEMS` in `undrawn`; leave the pane's `cap: Infinity` alone

## 3. Existing Tests

- [x] 3.1 Stub the row at `MAX_BAND_ITEMS` in the existing band tests that assume a 10-item window, keeping their scenarios and expected values
- [x] 3.2 Run `claude plugin test .`, `claude plugin validate .`, and `scripts/test-min-version.sh`, and confirm they pass

## 4. Documentation

- [x] 4.1 In `README.md` and `README.zh-TW.md`, describe the setting in the band section: its `/config` name, the range, the default, the fallback, and that the pane ignores it; replace the band's "up to 10" with the setting
- [x] 4.2 In `README.md` and `README.zh-TW.md`, drop the number from the pane's "no cap of 10", and say that any other number counts as the default and that a non-number written into `settings.json` by hand stops the mod from loading
