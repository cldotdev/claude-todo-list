import type { TodoItem } from '../types'

const MAX_ITEMS = 99
export const MAX_DONE = MAX_ITEMS
const MAX_ITEM_LENGTH = 80
export const MAX_DETAIL_LENGTH = 1000
// A guard against pasted logs, far above any normal turn.
const MAX_TEXT = 100_000

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

const LIST_FORMAT = `Reply with the complete list as a JSON array of {"title", "detail"} objects and nothing else: no code fence, no commentary, for example [{"title":"<title>","detail":"<detail>"}]. Reply with [] when nothing is open.
${ITEM_STYLE}`

const RESOLVE = `For every current item, decide whether this turn resolves it. Remove it when the turn answers it, decides it, completes it, or makes it moot, even when the turn does not name it. A user's reply to a question, or a choice among offered options, resolves that question. Keep an item only when it is still open after this turn.`

const CHANGE_FORMAT = `Reply with a JSON object and nothing else: no code fence, no commentary. "remove" lists the numbers of the current items this turn resolves, and "add" lists the new open items as {"title", "detail"} objects, for example {"remove":[2],"add":[{"title":"<title>","detail":"<detail>"}]}. Reply with {"remove":[],"add":[]} when nothing changed.
${ITEM_STYLE}`

export const SYSTEM = `You maintain a to-do list of open items for a coding conversation.\n\n${DEFINITION}\n\n${RESOLVE}\n\n${CHANGE_FORMAT}`

const HEAD_TEXT = 25_000

// Keeps the tail, where an answer usually ends with the question it leaves open.
const clip = (text: string) =>
  text.length > MAX_TEXT
    ? `${text.slice(0, HEAD_TEXT)}\n[truncated]\n${text.slice(HEAD_TEXT - MAX_TEXT)}`
    : text

const removedBlock = (done: readonly string[]) =>
  `Items the user removed (never add them back):\n${done.length === 0 ? '(none)' : JSON.stringify(done)}`

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
  done: readonly string[]
  previousAnswer: string
  userText: string
  answer: string
}): string {
  return [
    `Current list:\n${numbered(input.items)}`,
    removedBlock(input.done),
    `Agent final answer of the previous turn, which this turn's user message may reply to:\n${clip(input.previousAnswer) || '(none)'}`,
    `User message of this turn:\n${clip(input.userText) || '(none)'}`,
    `Agent final answer of this turn:\n${clip(input.answer) || '(none)'}`,
    'Return the changes.',
  ].join('\n\n')
}

export function refreshPrompt(done: readonly string[]): string {
  return [
    'This request comes from the todo-list plugin, not from the user. Do not continue the conversation or call tools; answer only this request. Rebuild the to-do list of open items from the whole conversation above.',
    DEFINITION,
    removedBlock(done),
    LIST_FORMAT,
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
function cleanItems(items: readonly TodoItem[]): TodoItem[] {
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

// Returns null when the reply is not a JSON array of {title, detail} objects.
export function parseItems(text: string): TodoItem[] | null {
  const parsed = parseJson(text, '[', ']')
  return isItems(parsed) ? cleanItems(parsed) : null
}

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

// Applies a {"remove": [...], "add": [...]} reply to the list it was asked
// about; returns null when the reply has another shape or names no such item.
export function applyChanges(text: string, items: readonly TodoItem[]): TodoItem[] | null {
  const parsed = parseJson(text, '{', '}') as { remove?: unknown; add?: unknown } | undefined
  const remove = parsed?.remove
  const add = parsed?.add
  if (
    !Array.isArray(remove) ||
    !remove.every(n => Number.isInteger(n) && n >= 1 && n <= items.length) ||
    !isItems(add)
  ) {
    return null
  }
  const gone = new Set(remove as number[])
  return cleanItems([...items.filter((_, i) => !gone.has(i + 1)), ...add])
}
