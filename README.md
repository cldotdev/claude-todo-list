# Claude Todo List

[![CI](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml/badge.svg)](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml)

English | [繁體中文](README.zh-TW.md)

A [Claude Code](https://code.claude.com) mod that keeps a running list of the open items in a conversation and shows it in a band above the prompt.

Long sessions leave decisions, promised follow-ups, and unanswered questions far back in the conversation, where they are easy to drop. The mod collects them as the conversation goes, so they stay in sight until they are settled.

![Demo](assets/demo.gif)

## How It Works

- After each main-loop turn that ends with an answer, the mod sends the turn to Sonnet (the `sonnet` alias, so the model follows the installed Claude Code version) and asks which current items the turn resolved and which new ones it opened. Subagent turns do not count.
- An open item is work someone deferred, a follow-up or check the agent promised, or a question or decision that is not settled yet. The step being carried out right now, anything finished within the same turn, and tasks already listed in an OpenSpec `tasks.md` stay off the list.
- Each item has a one-line title and a short detail, written in the language the agent answers in.
- The list is kept per session and comes back when the session is resumed. A saved list left unchanged for longer than `cleanupPeriodDays`, the setting for how long Claude Code keeps transcripts (30 days by default), is dropped. When the saved lists of all sessions pass 80% of the 4 MiB the mod's store can hold, the lists left unchanged the longest are dropped until they are back at 80%, never the current session's. If a list cannot be saved, a toast says so once per session. `/clear` empties the list and the trash.
- Every item that leaves the list goes to a trash with its title, its detail, who removed it (you or the model), and when. Each source keeps its newest 99 entries. Items you removed are never added back; items the model removed are not added back unless the conversation reopens them.
- An item that a later turn made moot has no turn of its own to remove it, so a review also runs over the recent turns: after 8 answered turns, or after 3 when the list holds 6 or more items. It only removes items that are no longer open; it never adds any. Removed items can be brought back with `/todos restore`.

Each answered turn costs one extra Sonnet call, and a review adds one more, at most one every 3 turns. `/todos refresh` forks the main conversation, so it runs on the main model with the whole context. It reviews each item on the list against that context: it removes the ones that are no longer open, adds missing ones, and may rewrite a kept item's detail, while every kept item keeps its title. Right after a resume there is nothing to fork yet, so it rebuilds the list from the transcript instead, on the main model without the prompt cache, which costs more. The transcript holds the newest 200,000 characters of the conversation, with each tool result cut to 2,000.

## Requirements

Claude Code with mod support (>= 2.1.299).

## Installation

Install it from this repository's marketplace:

```bash
claude plugin marketplace add cldotdev/claude-todo-list
claude plugin install todo-list@claude-todo-list
```

## Usage

### The `/todos` Command

| Command | Effect |
| --- | --- |
| `/todos` | Lists the open items with their details. |
| `/todos pane` | Opens the list in a pane, see [The Pane](#the-pane). From an empty prompt it hands the keys to the pane, also when the pane is already open. `/todos pane <text>` still sends `pane <text>` as a prompt. |
| `/todos refresh` | Reviews each item against the whole conversation: removes items that are no longer open, adds missing ones, and refreshes details. |
| `/todos clear` | Deletes every item. The items go to the trash as your deletions. |
| `/todos reset` | Empties the list and the trash, which also lifts every never-add-back block. |
| `/todos trash` | Lists the removed items, newest first, with their details and who removed each. |
| `/todos restore <numbers>` | Puts items from the trash back on the list, numbered as `/todos trash` shows them and written like `delete` numbers. A number past the end of the trash cancels the whole restore. |
| `/todos purge <numbers>` | Removes entries from the trash for good, numbered as `/todos trash` shows them. Purging an item you deleted lets the model add it back. |
| `/todos delete <numbers>` | Deletes items by number, such as `2`, `1-3`, or `1,4 6`. A number past the end of the list cancels the whole delete. |
| `/todos <prompt>` | Sends the prompt with every item quoted and numbered above it, so the prompt can say "do 1 and 2, skip 3". |

### The Band

The band above the prompt shows the numbered list while it has items and the pane is closed. It shows its items as a window over the list, each with its number in the whole list, and a dim `<n> more` line under them counts the items after the window. The window holds as many items as fit in the rows Claude Code gives the band, up to 10, so a long draft in the prompt box shrinks the window instead of scrolling the band. When the band holds the focus, its help line is longer and may take another row, which can drop one item from a squeezed window. Leaving the band puts the window back at the top.

| Key | Action |
| --- | --- |
| `Ctrl+X Tab` | Focus the band. |
| `j`/`k`, `Tab`/`Shift+Tab` | Move to the next or previous item. |
| `s` | Select or unselect the focused item. |
| `a` | Select every item, or clear the selection when every item is already selected. |
| `n`/`p` | Move the window down or up by up to the number of items it shows; the focus keeps its row in the window. They do nothing when the whole list fits in the window, when the window cannot move further, or in the detail view. |
| `v` | Paste the selected items, or the focused item when none is selected, into the prompt box. Each is quoted with its number in the band. |
| `o`/`Enter` | Show the focused item's detail, or go back to the list. |
| `t` | Switch to the pane, which hides the band. |
| `b` | Ask `/btw` about the focused item. While Claude is working, the answer waits for the current turn to end. |
| `d` | Delete the focused item; a second `d` confirms and `Esc` cancels. |
| `Esc` | Return to the prompt. The band goes back to the list if it was showing an item's detail. |

### The Pane

The pane lists the items in a pane of its own, which Claude Code docks beside the transcript from 110 columns in fullscreen, floor to ceiling, so a long prompt does not squeeze it. Every title is drawn whole, wrapped over as many rows as it needs, where the band cuts an unfocused title to one row. Its window holds as many items as fit in rows, with no cap of 10, and a dim `<n> more` line counts the items after it. With an empty list it shows `No open items.`

- **Opening**: `t` on the band or `/todos pane` opens it. Besides that it opens on its own only at session start or on a resume when the default view is `pane`, never when the band is squeezed. While the pane is open the band is not drawn, so the list shows in one place. `/todos pane` with an empty prompt box and nothing else holding the keys gives the pane the keys, also when it is already open. After `t`, the band still held the keys when the pane asked for them, so press `Ctrl+X Tab` once to reach the pane.
- **Default view**: the `default_view` setting, `band` (the default) or `pane`, shows in `/config` as `todo-list.default_view` and is saved in your settings. It applies when a session starts or is resumed, also with an empty list, and the pane it opens takes no keys, so what you type still goes to the prompt box; a change in `/config` takes effect at the next session start, and `t` switches at once. A hot reload of the mod and `/clear` do not apply it again. The pane opens only where Claude Code has room for it: a pane you did not ask for needs a terminal 144 columns wide (110 once you have opened it by hand), and on a narrower one the band stays.
- **Closing**: `t` on the pane, `Ctrl+X X`, or the pane's close mark closes it and brings the band back. It also clears the pane's focus, selection, and expanded detail. `Esc` hands the keys back to the prompt box and keeps the pane open. `/clear` empties the pane's state but leaves it open.
- **Keys**: the band's own, `j`/`k`, `Tab`/`Shift+Tab`, `s`, `a`, `n`/`p`, `v`, `o`/`Enter`, `b`, and `d`, with two differences: `o`/`Enter` expands the focused item's detail under its row, one item at a time, with the rest of the list still shown; moving the focus moves the expansion, and a second `o` collapses it; the pane has `t` to go back to the band instead of the band's `t` for the pane.
- **State**: the pane keeps its own focus, expanded detail, selection, armed delete, and window, apart from the band's. Typing in the prompt box, sending a prompt, and `Esc` do not reset them, and the band's leave does not touch them. A successful `v` clears the pane's selection. While the pane lacks the keys, it draws no focus dot but keeps its focus, and its help line names `Ctrl+X Tab` as the way back. When an item leaves the list by anything other than the pane's own delete, the pane's focus moves to the item now at the same position.

## Development

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | Event hooks, the `/todos` command, the band, and the pane. |
| `hooks/list.ts` | Model prompts, reply parsing, and the window arithmetic of the band and the pane. |
| `hooks/store.ts` | Store keys and the arithmetic that keeps the store under its size cap. |
| `types/index.d.ts` | The mod's state contract. |
| `tests/` | Tests run by `claude plugin test`. |

```bash
claude plugin validate .
claude plugin test .
```

To try local changes, start Claude Code with the clone loaded for that session:

```bash
claude --plugin-dir /path/to/claude-todo-list
```

The clone replaces an installed `todo-list@claude-todo-list` for that session, so there is no need to disable or uninstall it first.

## License

[MIT](LICENSE)
