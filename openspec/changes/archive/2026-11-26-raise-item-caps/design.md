## Context

See proposal.md for the motivation. `hooks/list.ts` holds one number, `MAX_ITEMS = 99`, and `MAX_TRASH` is defined as that number, so the list and both trash sources share a cap. Every per-turn update, review, and refresh sends the whole list with its details, and the titles of every trash entry, in one request. The limits in the code count characters, since the engine offers no token count.

Measured on 387 saved sessions: the median list holds 3 items and the longest 96, with titles of about 40 characters and details of about 180. At that density a full 999-item list is about 230,000 characters per request. In the longest session the 99 `model` entries the trash kept span under six days, and the `user` source held none.

The `sonnet` alias resolves to a model with a 1M-token context window and no long-context surcharge on the Anthropic API, and to a model with a 200k window on some other providers.

## Goals / Non-Goals

**Goals:**

- A list that can grow to 999 items without a change to the prompts.
- One `/todos clear` of a full list stays fully restorable, and keeps its never-add-back blocks.
- A restore never loses an entry.

**Non-Goals:**

- A budget that shortens the list inside the prompt. At the measured density the full list is expected to fit a 1M window; the tokens per character were not measured.
- A change to what happens at the cap: the items already listed stay and later additions are dropped.
- A notice when the list is full.

## Decisions

### The List's Cap Is 999

Raising one constant is the whole change to the list. The number labels, the number parsing, and both windows already follow the list's length. 300 was considered as a cap that also fits a 200k window with room to spare; 999 was chosen because the cap now guards cost and failure rather than fit, and a 1M window holds it.

### The Trash Caps Split by Source

`MAX_TRASH` becomes one cap per source: `user` follows the list's cap, and `model` stays at 99. The `user` entries carry the hard block against adding an item back and are what `/todos clear` writes, so their cap has to be at least the list's for a clear to be undone whole. The `model` entries are a hint to the model and a way back from a wrong removal; they are what grows over a long session, and each one adds a title to every request.

Raising both to 999 was rejected: with every item at its length limits, one session's entry would pass 80% of the store's cap, where the sweep starts dropping other sessions' lists. Keeping both at 99 was rejected because a clear of more than 99 items would lose the rest, with their blocks.

### A Restore Without Room Is Cancelled Whole

The restore counts the picked entries whose titles are not on the list, and cancels before changing anything when they outnumber the list's room. This matches the existing refusals, which cancel the whole command and end with `Nothing was restored.`. Restoring as many as fit was rejected: the reply would have to say which entries stayed behind, and the other refusals are all-or-nothing.

### One Reply Cap for Updates and Reviews

The review's reply cap rises from 2,048 to the 8,192 the per-turn update and the refresh already use, under one name. A review that removes several hundred items lists that many three-digit numbers, and a cut-off reply fails to parse, which leaves the list unchanged without a notice. The cap bounds a reply and costs nothing when the reply is short.

### The Completion Timeout Is 120 Seconds

`COMPLETE_TIMEOUT_MS` rises from 60 to 120 seconds for the per-turn update and the review. A request that times out leaves the list unchanged without a notice, and how long a request carrying several hundred thousand tokens takes has not been measured. The refresh from the transcript keeps its own 180 seconds. No test covers the new value: a test could only compare the request's timeout with the constant that sets it.

## Risks / Trade-offs

- [With every item at its length limits, a full list is about 1.09M characters, which can pass a 1M window when the text is mostly CJK; the request fails and the list stops updating without a notice] → Accepted. The measured density is a fifth of that.
- [On a provider where the alias resolves to a 200k window, a list of mostly CJK text can stop updating at several hundred items] → The READMEs say so, without naming providers, since the alias mapping is Claude Code's.
- [Each answered turn costs more as the list grows, about 230,000 characters of input at a full list] → Accepted; the cost follows the list's actual length, not the cap.
- [Whether `$.model.complete` gets the 1M window for the alias is not documented; its type says the alias resolves as a `--model` value does] → Accepted as unverified.
- [When an older version opens a session saved with more than 99 items, its next list update moves the items past 99 to the trash, which keeps 99 of them] → Accepted; a downgrade is the only way to meet it.
