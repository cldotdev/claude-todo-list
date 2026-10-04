# Claude Todo List

[![CI](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml/badge.svg)](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml)

English | [繁體中文](README.zh-TW.md)

A [Claude Code](https://code.claude.com) mod that keeps a running list of the open items in a conversation and shows it in a band above the prompt.

Long sessions leave decisions, promised follow-ups, and unanswered questions far back in the conversation, where they are easy to drop. The mod collects them as the conversation goes, so they stay in sight until they are settled.

## How It Works

- After each main-loop turn that ends with an answer, the mod sends the turn to Sonnet (the `sonnet` alias, so the model follows the installed Claude Code version) and asks which current items the turn resolved and which new ones it opened. Subagent turns do not count.
- An open item is work someone deferred, a follow-up or check the assistant promised, or a question or decision that is not settled yet. The step being carried out right now, anything finished within the same turn, and tasks already listed in an OpenSpec `tasks.md` stay off the list.
- Each item has a one-line title and a short detail, written in the language the assistant answers in.
- The list is kept per session and comes back when the session is resumed. A saved list left unchanged for longer than `cleanupPeriodDays`, the setting for how long Claude Code keeps transcripts (30 days by default), is dropped. `/clear` empties the list.
- Items you delete are remembered, so the model does not add them back.

Each answered turn costs one extra Sonnet call. `/todos refresh` forks the main conversation, so it runs on the main model with the whole context.

## Requirements

Claude Code with mod support (>= 2.1.289).

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
| `/todos refresh` | Rebuilds the list from the whole conversation. |
| `/todos clear` | Empties the list. |
| `/todos delete <numbers>` | Deletes items by number, such as `2`, `1-3`, or `1,4 6`. A number past the end of the list cancels the whole delete. |
| `/todos <prompt>` | Sends the prompt with every item quoted and numbered above it, so the prompt can say "do 1 and 2, skip 3". |

### The Band

The band above the prompt shows the numbered list while it has items.

| Key | Action |
| --- | --- |
| `ctrl+x tab` | Focus the band. |
| `tab`/`shift+tab` | Move to the next or previous item. |
| `o`/`enter` | Show the focused item's detail, or go back to the list. |
| `v` | Quote the focused item into the prompt box. |
| `y` | Quote every item, numbered, with blank lines between them to write under each. |
| `esc` | Return to the prompt. |

## Development

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | Event hooks, the `/todos` command, and the band. |
| `hooks/list.ts` | Model prompts and reply parsing. |
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
