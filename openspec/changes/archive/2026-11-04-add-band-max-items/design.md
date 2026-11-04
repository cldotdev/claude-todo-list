## Context

See proposal.md (Why) and specs/band-item-window/spec.md for the behavior. The band's render computes its window cap from `WINDOW_SIZE` and the rows the engine gives it, and records the result in `drawn.band`, which the key handlers read, so paging and focus moves follow whatever cap the render chose. The two existing settings are read with `$.config.list()` when they are used: `defaultView` and `itemLanguage`, each with a fallback for a read that throws.

## Goals / Non-Goals

**Goals:**

- A stored value that is out of range costs the user the setting, never the mod.

**Non-Goals:**

- Hiding the band with a value of 0.
- A limit on the band's total rows. The request counts items, and a row limit would drop items when the focused title wraps.
- Any change to the pane's window.

## Decisions

### The Manifest Declares No Range

The field is `"type": "number", "default": 5`, without `min` or `max`, and the code checks the range. A probe on Claude Code 2.1.304 and 2.1.318 shows that with `min`/`max` declared, a stored `0` or `99` fails with `hooks module did not load: options do not fit plugin.json userConfig`, which takes the whole mod down. Without them the same values load. `3.5` passes `min`/`max` either way, so the code needs an integer check regardless.

### Invalid Values Fall Back to the Default

A pure helper in `hooks/list.ts` takes the row's value as `unknown` and returns it when it is an integer from 1 through 10, otherwise the default. Alternative: clamp `0` to 1 and `11` to 10, and floor `3.5`. Rejected by the settled behavior: a value outside the range says nothing reliable about what the user wanted, and one rule covers every case.

### The Ceiling Stays at 10

The setting only lowers the window from the previous limit. Outside fullscreen, the engine's `maxRows` is the terminal's height, so a higher value could let the band fill the screen; 10 is what prevents that today. The pane serves long lists.

### The Render Reads the Setting With `$.config.list()`

The band's `AbovePrompt` render reads the row on each draw, beside its other reads, in a helper shaped like `defaultView`. A probe shows the call works inside a render hook. Alternative: the `options` argument of `register`. It is synchronous, but the mod ignores it today, and the reload on a change is documented, and was seen, only for a plugin loaded from a folder. In that session a change in `/config` reloaded the module and the band redrew as soon as the menu closed. Alternative: read once at session start, as `default_view` does. Rejected because a change would then wait for the next session, and nothing here needs that delay.

### `WINDOW_SIZE` Splits in Two

`hooks/list.ts` exports `DEFAULT_BAND_ITEMS` (5) and `MAX_BAND_ITEMS` (10) in place of `WINDOW_SIZE`. The render's cap arithmetic keeps its shape with the setting's value in place of the constant. `undrawn`, which only applies before a view's first draw, uses the default.

### The Name Counts Items

`band_max_items`, not the `max_rows` the issue suggests: the band has at least three rows beyond its items, and `maxRows` is already the engine's prop for the band's rows. The `band_` prefix says the pane is not covered.

### Existing Band Tests Set the Value to 10

Tests that exercise paging and scrolling over a 10-item window keep their scenarios by stubbing the row at 10. New tests pin the default, the range, and the fallback, including a row holding `"4"` or null, which pins the helper for any value the settings list reports. No test presses `n` through to a moved window, because the kit cannot answer a plugin's own `$.ui.focus`, so paging by the setting is tested through `pageRows`. Band tests that do not stub `config.list` read through the kit's "no implementation" error and get the default, which is the unreadable path.

## Risks / Trade-offs

- [The default drops from 10 to 5, so an upgrade changes the band for users who never set it] → Accepted. Nothing is hidden for good: the keys and the `<n> more` line still reach every item, and the release notes name the setting.
- [A non-number written into settings by hand still fails the load, as the engine checks a field's type whatever the mod reads] → Seen under the test kit on both versions and in a session on 2.1.318. The code cannot catch it, so the README names it. `/config` cannot cause it: its form answers `It takes a number.`
- [With no range declared, `/config` accepts 99, and its row shows 99 while the band shows 5] → Accepted as the cost of keeping the mod loaded. The field's description states the range and the fallback.
- [An extra engine call on each band draw] → The render already awaits seven state reads per draw.

## Migration Plan

Nothing is stored or migrated. The release bumps the minor version because of the new default. Rolling back restores the 10-item window; a stored `band_max_items` is then ignored.
