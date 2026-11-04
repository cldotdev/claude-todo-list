## Why

The band shows up to 10 items, which with its other rows is about 14 rows of the terminal, and the transcript has that much less room. The limit is a constant, so users cannot lower it (issue #2).

## What Changes

- A new `band_max_items` user setting, a number that `/config` shows as `todo-list.band_max_items`, sets the most items the band's window holds.
- Valid values are the integers 1 through 10. Any other number counts as unset and gives the default.
- **BREAKING**: the default is 5, down from the fixed 10. On a list of more than 5 items, a user who has not set it sees fewer items after upgrading, and reaches the rest with the same keys. Setting it to 10 restores the previous band.
- The band keeps shrinking below the setting when the prompt box needs rows. The pane stays uncapped and ignores the setting.

## Capabilities

### New Capabilities

### Modified Capabilities

- `band-item-window`: the window holds at most `band_max_items` items instead of at most 10, with a default of 5 and a fallback for values outside 1 through 10.

## Impact

- `.claude-plugin/plugin.json`: the new `userConfig` field, and a minor version bump at release, whose notes carry the new default.
- `hooks/list.ts`: the default, the ceiling, and the validation replace `WINDOW_SIZE`.
- `hooks/register.tsx`: the band's render reads the setting and sizes its window from it.
- `tests/todo-list.test.ts`: tests for the setting; band tests that assume a 10-item window set it to 10.
- `README.md`, `README.zh-TW.md`: the setting and the band's description.

## Amendments

Made after archiving; the main spec `band-item-window` carries the resulting behavior, and this change's design.md and specs record the design as first archived.

- **`band_max_items` is a choice of `"1"` through `"10"`, not a number.** A real session showed `/config` accepting 99 and showing it in the row while the band showed 5. Declaring `min` and `max` made the form refuse it, but a value edited into settings by hand then stopped the mod from loading, and a number field without a range still does so for text. Probes on Claude Code 2.1.304 and 2.1.318 show a string field with `options` is the only field type where every stored value outside them counts as unset, so the mod always loads. This replaces the design's number field, its No Range decision, and its fallback for numbers. `/config` can no longer take an invalid value, so no refusal message is needed. The cost is that the value cannot be typed. `$.config.list()` reports the stored value as a string rather than the value the engine validated, so a number from 1 through 10 edited by hand still takes effect, although the engine's notice says it reads as the default, and `/config` shows any stored value as written.
- **The band reads the setting only when it draws items.** `$.config.list()` rebuilds the whole `/config` model, about as much work as the render's seven state reads together, so the read moved after the render's early return.
