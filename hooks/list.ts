import type { SessionMessage } from 'claude-code'

import type { ReviewTurn, TodoItem, TrashEntry } from '../types'

const MAX_ITEMS = 99
export const MAX_TRASH = MAX_ITEMS
const MAX_ITEM_LENGTH = 80
export const MAX_DETAIL_LENGTH = 1000
// A guard against pasted logs, far above any normal turn.
const MAX_TEXT = 100_000
// A review carries up to REVIEW_TURNS turns, so each is held to a smaller share.
const REVIEW_TURN_TEXT = 20_000
export const REVIEW_TURNS = 8
export const REVIEW_MIN_TURNS = 3
export const REVIEW_MIN_ITEMS = 6
export const TRANSCRIPT_TOOL_RESULT_TEXT = 2_000
export const TRANSCRIPT_TEXT = 200_000

const DEFINITION = `An open item is something still pending in this conversation:
- Work the user or the agent deferred (for example "later", "not now", "先不做", "之後再處理", "next step").
- A follow-up the agent promised, or a check it said it had not run yet.
- A decision or question raised in the discussion and not settled yet, whoever raised it: a choice among options waiting for the user, a question either side asked that has no answer or conclusion yet, or a point left to decide later.

Do not list:
- The step being carried out right now. A pending decision or open question is never this step.
- Anything raised and finished within the same turn.
- Tasks already listed in an OpenSpec tasks.md.

Remove an item once the conversation shows it is done or the user drops it.`

const ITEM_STYLE = `Write each item as an object with a "title" and a "detail", both in the language the agent answers in. Call the side that answers the user "the agent", never "the assistant"; in Chinese, keep it as the English word "agent", lowercase mid-sentence.
- "title": one short line (at most ${MAX_ITEM_LENGTH} characters). Use half-width parentheses with a space before the opening one. End a title that carries a status, such as awaiting the user's reply or not yet tested, with that status in parentheses, written in the title's language, and nothing after it, as in "<what to do> (<status>)".
- "detail": what to do, why it matters, and which part of the discussion it came from (at most ${MAX_DETAIL_LENGTH} characters, newlines included), so a reader who lost the conversation can act on it. Do not repeat the title. Put each distinct point on its own line, separated by a newline in the JSON string, as plain text with no Markdown bullets or headings.`

const RESOLVE = `For every current item, decide whether this turn resolves it. Remove it when the turn answers it, decides it, completes it, or makes it moot, even when the turn does not name it. A user's reply to a question, or a choice among offered options, resolves that question. Keep an item only when it is still open after this turn.`

const CHANGE_FORMAT = `Reply with a JSON object and nothing else: no code fence, no commentary. "remove" lists the numbers of the current items this turn resolves, and "add" lists the new open items as {"title", "detail"} objects, for example {"remove":[2],"add":[{"title":"<title>","detail":"<detail>"}]}. Reply with {"remove":[],"add":[]} when nothing changed.
${ITEM_STYLE}`

const REVIEW_RESOLVE = `For every current item, decide whether it is still open at the end of the turns below. Remove it when a later turn answered it, decided it, completed it, dropped it, or made it moot, even when no turn names it, and keep it only when the end of the turns still leaves it open.`

const REVIEW_FORMAT = `Reply with a JSON object and nothing else: no code fence, no commentary. "remove" lists the numbers of the current items that are no longer open, for example {"remove":[2]}. Reply with {"remove":[]} when every item is still open. Do not add items.`

const REFRESH_FORMAT = `Reply with a JSON object and nothing else: no code fence, no commentary. "remove" lists the numbers of the current items that are no longer open, "add" lists open items the list is missing as {"title", "detail"} objects, and "update" lists {"number", "detail"} objects for kept items whose detail is out of date or empty, for example {"remove":[2],"add":[{"title":"<title>","detail":"<detail>"}],"update":[{"number":1,"detail":"<detail>"}]}. An update changes only the detail; a kept item keeps its title. Reply with {"remove":[],"add":[],"update":[]} when nothing changed.
${ITEM_STYLE}`

export const SYSTEM = `You maintain a to-do list of open items for a coding conversation.\n\n${DEFINITION}\n\n${RESOLVE}\n\n${CHANGE_FORMAT}`

export const REVIEW_SYSTEM = `You review a to-do list of open items for a coding conversation. You only remove items that are no longer open.\n\n${DEFINITION}\n\n${REVIEW_RESOLVE}\n\n${REVIEW_FORMAT}`

// Keeps the tail, where an answer usually ends with the question it leaves open.
const clip = (text: string, max = MAX_TEXT) =>
  text.length > max
    ? `${text.slice(0, max / 4)}\n[truncated]\n${text.slice(max / 4 - max)}`
    : text

export type RemovedTitles = { user: readonly string[]; model: readonly string[] }

export const removedTitles = (entries: readonly TrashEntry[]): RemovedTitles => ({
  user: entries.filter(one => one.by === 'user').map(one => one.title),
  model: entries.filter(one => one.by === 'model').map(one => one.title),
})

const titlesOf = (titles: readonly string[]) => (titles.length === 0 ? '(none)' : JSON.stringify(titles))

const removedBlocks = (removed: RemovedTitles) =>
  [
    `Items the user removed (never add them back):\n${titlesOf(removed.user)}`,
    `Items removed earlier because they were no longer open (do not add them back unless the conversation reopens them):\n${titlesOf(removed.model)}`,
  ].join('\n\n')

// Prefixes every line of a multi-line text, such as an item's detail.
export const prefixLines = (text: string, prefix: string) =>
  text
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n')

const numbered = (items: readonly TodoItem[]) =>
  items.length === 0
    ? '(none)'
    : items
        .map((one, i) => `${i + 1}. ${one.title}${one.detail === '' ? '' : `\n${prefixLines(one.detail, '   ')}`}`)
        .join('\n')

export function incrementalPrompt(input: {
  items: readonly TodoItem[]
  removed: RemovedTitles
  previousAnswer: string
  userText: string
  answer: string
}): string {
  return [
    `Current list:\n${numbered(input.items)}`,
    removedBlocks(input.removed),
    `Agent final answer of the previous turn, which this turn's user message may reply to:\n${clip(input.previousAnswer) || '(none)'}`,
    `User message of this turn:\n${clip(input.userText) || '(none)'}`,
    `Agent final answer of this turn:\n${clip(input.answer) || '(none)'}`,
    'Return the changes.',
  ].join('\n\n')
}

export function reviewPrompt(input: {
  items: readonly TodoItem[]
  removed: RemovedTitles
  turns: readonly ReviewTurn[]
}): string {
  const turns = input.turns.map(
    (one, i) =>
      `Turn ${i + 1} of ${input.turns.length}\nUser message:\n${clip(one.userText, REVIEW_TURN_TEXT) || '(none)'}\nAgent final answer:\n${clip(one.answer, REVIEW_TURN_TEXT) || '(none)'}`,
  )
  return [
    `Current list:\n${numbered(input.items)}`,
    removedBlocks(input.removed),
    ...turns,
    'Return the removals.',
  ].join('\n\n')
}

const BLOCK_SEPARATOR = '\n\n'

// A user message that only carries tool results renders to nothing, since the
// results already sit under the calls that made them.
const renderMessage = (message: SessionMessage) =>
  [
    message.text === '' ? '' : `[${message.role}]\n${message.text}`,
    ...message.toolUses.map(
      use => `[tool ${use.tool}]\n${clip(use.text ?? '', TRANSCRIPT_TOOL_RESULT_TEXT) || '(no result)'}`,
    ),
  ]
    .filter(block => block !== '')
    .join(BLOCK_SEPARATOR)

// Renders the newest messages that fit TRANSCRIPT_TEXT, dropping whole oldest
// messages first; a lone newest message past the limit is clipped instead.
export function renderTranscript(messages: readonly SessionMessage[]): string {
  const kept: string[] = []
  let length = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const block = renderMessage(messages[i] as SessionMessage)
    if (block === '') {
      continue
    }
    const next = length + block.length + (kept.length === 0 ? 0 : BLOCK_SEPARATOR.length)
    if (next > TRANSCRIPT_TEXT && kept.length > 0) {
      break
    }
    kept.push(clip(block, TRANSCRIPT_TEXT))
    length = next
  }
  return kept.reverse().join(BLOCK_SEPARATOR)
}

// Without a transcript, the prompt refers to the conversation already in context.
export function refreshPrompt({
  items,
  removed,
  transcript,
}: {
  items: readonly TodoItem[]
  removed: RemovedTitles
  transcript?: string
}): string {
  const [head, source] =
    transcript === undefined
      ? [[], 'the whole conversation above']
      : [[`Transcript of the conversation:\n\n${transcript}`], 'the transcript above']
  return [
    ...head,
    `This request comes from the todo-list plugin, not from the user. Do not continue the conversation or call tools; answer only this request. Review the current to-do list against ${source}.`,
    DEFINITION,
    `Current list:\n${numbered(items)}`,
    removedBlocks(removed),
    'Judge each current item from where the conversation ended, and keep it only when the conversation shows it is still open. Also add open items the list is missing.',
    REFRESH_FORMAT,
  ].join('\n\n')
}

const FULL_WIDTH_PUNCTUATION = '，。、；：！？'

// Turns full-width parentheses into half-width ones, spaced as Taiwan prose
// spaces them: a space outside each, none next to full-width punctuation.
const SPACED_OPEN = new RegExp(`([${FULL_WIDTH_PUNCTUATION}])\\s+\\(`, 'g')
const UNSPACED_CLOSE = new RegExp(`\\)(?=[^\\s${FULL_WIDTH_PUNCTUATION})」』])`, 'g')

export const normalizeParens = (text: string) =>
  text
    .replace(/\s*（\s*/g, ' (')
    .replace(/\s*）/g, ')')
    .replace(SPACED_OPEN, '$1(')
    .replace(UNSPACED_CLOSE, ') ')
    .trim()

const tidy = (text: string) => normalizeParens(text.replace(/\s+/g, ' '))

// Keeps the line breaks of a detail, tidying each line and dropping empty ones.
const tidyDetail = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(tidy)
    .filter(line => line !== '')
    .join('\n')
    .slice(0, MAX_DETAIL_LENGTH)
    .trimEnd()

// Normalizes, trims, deduplicates by title and caps a list of items.
export function cleanItems(items: readonly TodoItem[]): TodoItem[] {
  const seen = new Set<string>()
  const kept: TodoItem[] = []
  for (const one of items) {
    const title = tidy(one.title).slice(0, MAX_ITEM_LENGTH)
    if (title !== '' && !seen.has(title)) {
      seen.add(title)
      kept.push({ title, detail: tidyDetail(one.detail) })
    }
  }
  return kept.slice(0, MAX_ITEMS)
}

function parseJson(text: string, open: string, close: string): unknown {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start === -1 || end < start) {
    return undefined
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export const isItem = (value: unknown): value is TodoItem =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TodoItem).title === 'string' &&
  typeof (value as TodoItem).detail === 'string'

const isItems = (value: unknown): value is TodoItem[] => Array.isArray(value) && value.every(isItem)

// Resolves item numbers such as "2", "1-3" or "1,4 6" against a list of
// `count` items. Returns the numbers ascending and distinct, the smallest
// number past the list when there is one, or null when the text is not such
// a list.
export function parseNumbers(
  text: string,
  count: number,
): { numbers: number[] } | { missing: number } | null {
  const tokens = text.split(/[\s,]+/).filter(token => token !== '')
  if (tokens.length === 0) {
    return null
  }
  const numbers = new Set<number>()
  let missing = Infinity
  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (match === null) {
      return null
    }
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    if (from < 1 || to < from) {
      return null
    }
    if (to > count) {
      missing = Math.min(missing, Math.max(from, count + 1))
    }
    for (let n = from; n <= Math.min(to, count); n += 1) {
      numbers.add(n)
    }
  }
  return missing === Infinity ? { numbers: [...numbers].sort((a, b) => a - b) } : { missing }
}

const isNumberIn = (n: unknown, count: number): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count

// The reply's "remove" applied to the `items` it was asked about: the numbers it
// names and the items it leaves, with the reply's raw "add" and "update". Null
// when "remove" is not a list of numbers within `items`.
function parseRemove(text: string, items: readonly TodoItem[]) {
  const parsed = parseJson(text, '{', '}') as Record<string, unknown> | undefined
  const remove = parsed?.remove
  if (parsed === undefined || !Array.isArray(remove) || !remove.every(n => isNumberIn(n, items.length))) {
    return null
  }
  const gone = new Set(remove as number[])
  return { gone, kept: items.filter((_, i) => !gone.has(i + 1)), add: parsed.add, update: parsed.update }
}

// Applies a {"remove": [...], "add": [...]} reply to the list it was asked
// about; returns null when the reply has another shape or names no such item.
export function applyChanges(text: string, items: readonly TodoItem[]): TodoItem[] | null {
  const change = parseRemove(text, items)
  const add = change?.add
  if (change === null || !isItems(add)) {
    return null
  }
  return cleanItems([...change.kept, ...add])
}

// Applies a {"remove": [...]} reply; any "add" in it is ignored.
export function applyReview(text: string, items: readonly TodoItem[]): TodoItem[] | null {
  const change = parseRemove(text, items)
  return change === null ? null : change.kept
}

// Applies a {"remove": [...], "add": [...], "update": [{number, detail}]} reply.
// An update takes the new detail and keeps the title. The reply fails when an
// update names no such item, an item twice, or a removed item, or leaves the
// detail empty.
export function applyRefresh(text: string, items: readonly TodoItem[]): TodoItem[] | null {
  const change = parseRemove(text, items)
  const add = change?.add
  const updates = change?.update ?? []
  if (change === null || !isItems(add) || !Array.isArray(updates)) {
    return null
  }
  const details = new Map<number, string>()
  for (const one of updates as { number?: unknown; detail?: unknown }[]) {
    const detail = typeof one?.detail === 'string' ? tidyDetail(one.detail) : ''
    if (!isNumberIn(one?.number, items.length) || change.gone.has(one.number) || details.has(one.number) || detail === '') {
      return null
    }
    details.set(one.number, detail)
  }
  const kept = items.flatMap((one, i) =>
    change.gone.has(i + 1) ? [] : [{ title: one.title, detail: details.get(i + 1) ?? one.detail }],
  )
  return cleanItems([...kept, ...add])
}

// The most items the band shows at a time.
export const WINDOW_SIZE = 10

// Characters the terminal draws two cells wide: CJK, Hangul, and full-width forms.
const WIDE_CLASS = '[\\u1100-\\u115F\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]'
const WIDE = new RegExp(WIDE_CLASS)
// Whitespace, one wide character, or a run of narrow non-space characters.
const WRAP_TOKEN = new RegExp(`\\s+|${WIDE_CLASS}|(?:(?!${WIDE_CLASS})\\S)+`, 'gu')

export const charWidth = (ch: string) => (WIDE.test(ch) ? 2 : 1)
export const cellWidth = (text: string) => [...text].reduce((n, ch) => n + charWidth(ch), 0)

// The rows `text` takes in `columns` cells under word wrap: a row starts at each
// newline, a Latin word moves whole to the next row, and a wide character can
// break anywhere.
export function wrapRows(text: string, columns: number): number {
  const width = Math.max(1, columns)
  let rows = 0
  for (const line of text.split('\n')) {
    rows += 1
    let used = 0
    for (const [token] of line.matchAll(WRAP_TOKEN)) {
      const cells = cellWidth(token)
      if (/^\s/.test(token)) {
        if (used + cells > width) {
          rows += 1
          used = 0
        } else {
          used += cells
        }
      } else if (used + cells <= width) {
        used += cells
      } else if (cells <= width) {
        rows += 1
        used = cells
      } else {
        // A word longer than a row breaks wherever it hits the edge.
        for (const ch of token) {
          const w = charWidth(ch)
          if (used + w > width) {
            rows += 1
            used = 0
          }
          used += w
        }
      }
    }
  }
  return rows
}

// How many items a window holds in `rows` rows when the view's other lines take
// `others` of them: the whole list when it fits with them, else what is left
// after the `<n> more` row, at least 1 while the list has items.
export function windowSize(rows: number, length: number, others: number, cap = Infinity): number {
  if (length <= cap && length + others <= rows) {
    return length
  }
  return Math.min(length, cap, Math.max(1, rows - others - 1))
}

// The window's first item: `start` moved the least distance that shows the
// item at `index` (-1 for none), then held so the window stays full.
export function windowFor(length: number, start: number, index: number, size: number): number {
  let next = start
  if (index !== -1) {
    next = Math.min(Math.max(next, index - size + 1), index)
  }
  return Math.min(Math.max(next, 0), Math.max(0, length - size))
}

// A page move from the window drawn over the item at `index`: the new start,
// and the item that keeps the focus's row. Null when the window cannot move.
export function pageFor(
  length: number,
  start: number,
  index: number,
  step: 1 | -1,
  size: number,
): { start: number; index: number } | null {
  const drawn = windowFor(length, start, index, size)
  const next = windowFor(length, drawn + step * size, -1, size)
  return next === drawn ? null : { start: next, index: index + next - drawn }
}

// How many items fit in `rows` rows from `start` on, with the `<n> more` row
// when items come after them; at least 1 for a nonempty list.
function rowsFit(heights: readonly number[], start: number, rows: number): number {
  let used = 0
  let count = 0
  for (let i = start; i < heights.length; i += 1) {
    used += heights[i]!
    if (used + (i + 1 < heights.length ? 1 : 0) > rows) {
      break
    }
    count += 1
  }
  return Math.max(1, count)
}

// The row-based window: `heights` holds each item's rows, `rows` the rows left
// for items once the view's other lines are taken out, apart from the `<n> more`
// row, which this reserves while items come after the window. From `start` it
// moves the least distance that shows the whole item at `index` (-1 for none),
// then, when the window reaches the last item, pulls up while earlier items
// still fit.
export function rowWindow(
  heights: readonly number[],
  start: number,
  index: number,
  rows: number,
): { start: number; count: number } {
  if (heights.length === 0) {
    return { start: 0, count: 0 }
  }
  let next = Math.min(Math.max(start, 0), heights.length - 1)
  if (index !== -1) {
    next = Math.min(next, index)
    while (index >= next + rowsFit(heights, next, rows)) {
      next += 1
    }
  }
  let count = rowsFit(heights, next, rows)
  if (next + count >= heights.length) {
    let used = heights.slice(next).reduce((sum, height) => sum + height, 0)
    while (next > 0 && used + heights[next - 1]! <= rows) {
      next -= 1
      used += heights[next]!
    }
    count = rowsFit(heights, next, rows)
  }
  return { start: next, count }
}

// A page move over row heights, from the window drawn around the item at
// `index`: the next window starts at the first item after the current one and
// the previous one ends just before the current start. The focus keeps its
// offset in the window, clamped to the new window's items. Null when the window
// cannot move.
export function pageRows(
  heights: readonly number[],
  start: number,
  index: number,
  step: 1 | -1,
  rows: number,
): { start: number; index: number } | null {
  const drawn = rowWindow(heights, start, index, rows)
  let next = drawn.start
  if (step === 1) {
    const after = drawn.start + drawn.count
    next = after >= heights.length ? next : rowWindow(heights, after, -1, rows).start
  } else if (next > 0) {
    next -= 1
    let used = heights[next]!
    // The window ends before the current start, so the `<n> more` row follows it.
    while (next > 0 && used + heights[next - 1]! + 1 <= rows) {
      next -= 1
      used += heights[next]!
    }
  }
  if (next === drawn.start) {
    return null
  }
  const { count } = rowWindow(heights, next, -1, rows)
  return { start: next, index: next + Math.min(index - drawn.start, count - 1) }
}
