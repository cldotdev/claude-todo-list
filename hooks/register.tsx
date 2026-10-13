import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PendingTurn, ReviewTurn, TodoItem, TodoListState, TrashEntry } from '../types'
import {
  MAX_TRASH,
  REVIEW_MIN_ITEMS,
  REVIEW_MIN_TURNS,
  REVIEW_SYSTEM,
  REVIEW_TURNS,
  SYSTEM,
  WINDOW_SIZE,
  type RemovedTitles,
  applyChanges,
  applyRefresh,
  applyReview,
  cleanItems,
  isItem,
  incrementalPrompt,
  normalizeParens,
  parseNumbers,
  prefixLines,
  refreshPrompt,
  renderTranscript,
  removedTitles,
  pageFor,
  reviewPrompt,
  windowFor,
} from './list'

const MODEL = 'sonnet'
const STORE_PREFIX = 'session:'
const DAY_MS = 24 * 60 * 60 * 1000
// Claude Code's own default for cleanupPeriodDays.
const DEFAULT_CLEANUP_DAYS = 30
const COMPLETE_TIMEOUT_MS = 60_000
// The transcript fallback sends up to TRANSCRIPT_TEXT characters to the main model.
const TRANSCRIPT_TIMEOUT_MS = 180_000
// Rows take no hotkey: a digit hotkey also fires from an empty prompt, so a
// message starting with "1." would quote the first item. A letter fires only
// while the band holds the focus.
const NEXT_KEY = 'j'
const PREVIOUS_KEY = 'k'
const DETAILS_KEY = 'o'
const SELECT_KEY = 's'
const SELECT_ALL_KEY = 'a'
const PASTE_KEY = 'v'
const NEXT_PAGE_KEY = 'n'
const PREVIOUS_PAGE_KEY = 'p'
const ASK_KEY = 'b'
const DELETE_KEY = 'd'
// Not hotkeys: Enter presses the focused row's Button, which shows its detail.
const ENTER_KEY = 'Enter'
const LEAVE_KEY = 'Esc'
// Characters the terminal draws two cells wide: CJK, Hangul, and full-width forms.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

const charWidth = (ch: string) => (WIDE.test(ch) ? 2 : 1)
const cellWidth = (text: string) => [...text].reduce((n, ch) => n + charWidth(ch), 0)

// The longest start of `text` that fits in `cells`, with an ellipsis.
function fit(text: string, cells: number): string {
  let used = 1
  let out = ''
  for (const ch of text) {
    used += charWidth(ch)
    if (used > cells) {
      break
    }
    out += ch
  }
  return `${out}…`
}

// A trailing parenthetical, such as an item's caveat, drawn apart from the rest.
const NOTE = /^(.*?)\s*(\([^()]*\))$/
const ROW_PREFIX = 'item-'
// How often the band checks whether the person has left it with Esc.
const LEAVE_CHECK_MS = 100
// The width of a row's focus marker and the space after it, so the title and
// the help line start where the item numbers do.
const GUTTER = '  '
// A theme key, so a selected row follows the person's theme.
const SELECTED_COLOR = 'suggestion'
// Palette index 1 (red), so the terminal theme picks the shade. A plugin's
// color may not hold a colon, which rules out `ansi:red`.
const DELETE_COLOR = 'ansi256(1)'

const items = atom({ plugin: 'todo-list', key: 'items' } as const, [])
const trash = atom({ plugin: 'todo-list', key: 'trash' } as const, [] as TrashEntry[])
// The counted turns since the last review. Like `pending`, it needs no store: a
// resumed session starts a new window.
const review = atom({ plugin: 'todo-list', key: 'review' } as const, [] as ReviewTurn[])
// Titles: the item the band's focus ring stands on ('' while the ring is
// outside the band), and the item whose detail the band shows.
const focused = atom({ plugin: 'todo-list', key: 'focused' } as const, '')
const detailed = atom({ plugin: 'todo-list', key: 'detailed' } as const, '')
// The title of the item the first delete press armed; the next press deletes it.
const deleting = atom({ plugin: 'todo-list', key: 'deleting' } as const, '')
// Titles of the items picked for a paste. Session-only: never written to the store.
const selected = atom({ plugin: 'todo-list', key: 'selected' } as const, [] as string[])
// The index of the window's first item. Like the focus, it lasts only while the
// band holds the focus.
const windowStart = atom({ plugin: 'todo-list', key: 'windowStart' } as const, 0)
// The last main-loop answer, which the next user message often replies to.
const lastAnswer = atom({ plugin: 'todo-list', key: 'lastAnswer' } as const, '')
// Finished turns not yet applied. They live in $.state, not the module, because
// a hot reload cancels the module's timers: a turn queued as the reload lands
// waits here, and session.start, which runs again after the reload, picks it up.
const pending = atom({ plugin: 'todo-list', key: 'pending' } as const, [] as PendingTurn[])

// An entry saved before items had a detail holds plain strings, and one saved
// before the trash holds the titles the user removed as `done`.
type Stored = {
  items: (string | TodoItem)[]
  trash?: TrashEntry[]
  done?: string[]
  updatedAt: number
}

const isTrashEntry = (value: unknown): value is TrashEntry =>
  isItem(value) &&
  ((value as TrashEntry).by === 'user' || (value as TrashEntry).by === 'model') &&
  typeof (value as TrashEntry).at === 'number'

const isStored = (value: unknown): value is Stored =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Stored).items) &&
  (value as Stored).items.every(one => typeof one === 'string' || isItem(one)) &&
  ((value as Stored).trash === undefined ||
    (Array.isArray((value as Stored).trash) && ((value as Stored).trash ?? []).every(isTrashEntry))) &&
  (Array.isArray((value as Stored).trash) || Array.isArray((value as Stored).done)) &&
  typeof (value as Stored).updatedAt === 'number'

const migrate = (stored: (string | TodoItem)[]): TodoItem[] =>
  stored.map(one => (typeof one === 'string' ? { title: one, detail: '' } : one))

const loadTrash = (stored: Stored): TrashEntry[] =>
  stored.trash ?? (stored.done ?? []).map(title => ({ title, detail: '', by: 'user', at: stored.updatedAt }))

// Each source keeps its own newest MAX_TRASH entries.
function capTrash(entries: readonly TrashEntry[]): TrashEntry[] {
  const newest = (by: TrashEntry['by']) => entries.filter(one => one.by === by).slice(-MAX_TRASH)
  const kept = new Set([...newest('user'), ...newest('model')])
  return entries.filter(one => kept.has(one))
}

// A saved list lives as long as Claude Code keeps the session's transcript,
// since a session it has deleted cannot be resumed. Null for an invalid
// setting, under which Claude Code pauses its own cleanup.
async function maxAgeMs($: EngineInterface): Promise<number | null> {
  const { cleanupPeriodDays: days = DEFAULT_CLEANUP_DAYS } = await $.settings.read()
  return typeof days === 'number' && days >= 1 ? days * DAY_MS : null
}

const userTexts = new Map<string, string>()
// Runs list updates one at a time, so two turns never race.
let queue: Promise<unknown> = Promise.resolve()
// Bumped by /clear so a job that started before it drops its result.
let generation = 0
// Whether a leave check is scheduled, so focus moves start only one.
let isWatchingLeave = false

// The selection as the list holds it now: a deleted item drops out.
const pickedFrom = (list: readonly TodoItem[], titles: readonly string[]) =>
  list.filter(one => titles.includes(one.title))

async function setSelected($: EngineInterface, next: string[]) {
  const same = (list: string[]) => list.length === next.length && list.every((title, i) => title === next[i])
  if (!same(await read($, selected))) {
    await update($, selected, () => next)
  }
}

async function disarm($: EngineInterface) {
  if ((await read($, deleting)) !== '') {
    await update($, deleting, () => '')
  }
}

// The dot, the selection, a pending delete, the detail view, and the window's
// position last only while the band holds the focus.
async function leave($: EngineInterface) {
  const [current, shown, start] = await Promise.all([read($, focused), read($, detailed), read($, windowStart)])
  if (start !== 0) {
    await update($, windowStart, () => 0)
  }
  if (current !== '') {
    await update($, focused, () => '')
  }
  if (shown !== '') {
    await update($, detailed, () => '')
  }
  await setSelected($, [])
  await disarm($)
}

// The band raises no event when the person leaves it with Esc. While the dot
// is shown, a timer asks the engine to put the ring back on the focused row;
// the engine refuses once the band no longer holds the keys, and the refusal
// counts as leaving.
function watchLeave($: EngineInterface, requestId: string) {
  if (isWatchingLeave) {
    return
  }
  isWatchingLeave = true
  const check = async () => {
    const [list, current] = await Promise.all([read($, items), read($, focused)])
    const index = list.findIndex(one => one.title === current)
    if (index !== -1) {
      const { deny } = await $.ui.focus({ requestId, key: `${ROW_PREFIX}${index}` })
      if (deny === undefined) {
        schedule()
        return
      }
      await leave($)
    }
    isWatchingLeave = false
  }
  const schedule = () => {
    $.clock.after(LEAVE_CHECK_MS, () => {
      check().catch(() => {
        isWatchingLeave = false
      })
    })
  }
  schedule()
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job)
  queue = run.catch(() => undefined)
  return run
}

async function persist($: EngineInterface) {
  const [id, list, entries] = await Promise.all([$.session.id(), read($, items), read($, trash)])
  const key = STORE_PREFIX + id
  const state: TodoListState = { items: list, trash: entries }
  if (state.items.length === 0 && state.trash.length === 0) {
    await $.store.delete(key)
    return
  }
  await $.store.set(key, { ...state, updatedAt: await $.clock.now() })
}

async function commit($: EngineInterface, next: TodoItem[]) {
  await update($, items, () => next)
  await persist($)
}

// A new entry replaces an older one with the same title.
async function record($: EngineInterface, removed: readonly TodoItem[], by: TrashEntry['by']) {
  if (removed.length === 0) {
    return
  }
  const at = await $.clock.now()
  const titles = new Set(removed.map(one => one.title))
  await update($, trash, list =>
    capTrash([...list.filter(one => !titles.has(one.title)), ...removed.map(one => ({ ...one, by, at }))]),
  )
}

async function tick($: EngineInterface, titles: readonly string[]) {
  const ticked = new Set(titles)
  const list = await read($, items)
  await update($, items, current => current.filter(one => !ticked.has(one.title)))
  await record($, pickedFrom(list, titles), 'user')
  await persist($)
}

// `1. ` through `10. `, padded to the widest number so every title starts in
// one column.
const labelWidth = (last: number) => `${last}.`.length + 1
const numberLabel = (number: number, width: number) => `${number}.`.padEnd(width)

// Numbered titles, each with its detail lined up under it.
function numberedLines<T extends TodoItem>(list: readonly T[], title: (one: T) => string = one => one.title): string[] {
  const width = labelWidth(list.length)
  return list.flatMap((one, i) => {
    const line = `${numberLabel(i + 1, width)}${title(one)}`
    return one.detail === '' ? [line] : [line, prefixLines(one.detail, ' '.repeat(width))]
  })
}

// The detail lines up under the title.
function quoteBlock(item: TodoItem, number: number, width: number): string {
  const label = numberLabel(number, width)
  const text =
    item.detail === ''
      ? `${label}${item.title}`
      : `${label}${item.title}\n${prefixLines(item.detail, ' '.repeat(label.length))}`
  return `${prefixLines(text, '> ')}\n`
}

// Numbered as the list shows them, so a prompt can say "do 1 and 2, skip 3",
// with a bare quote line between items.
function quoteItems(list: readonly TodoItem[], picked: readonly TodoItem[]): string {
  const numbers = picked.map(one => list.indexOf(one) + 1)
  const width = labelWidth(Math.max(...numbers))
  return picked.map((one, i) => quoteBlock(one, numbers[i]!, width)).join('>\n')
}

async function insertQuote($: EngineInterface, quoted: string): Promise<boolean> {
  const filled = await $.prompt.fill({ text: `${quoted}\n`, mode: 'insert' })
  if (!filled.isFilled) {
    $.ui.toast('Could not insert into the prompt box. Close the dialog and try again.')
  }
  return filled.isFilled
}

// Pastes the selected items, or the focused one when nothing is selected, each
// numbered as in the band.
async function paste($: EngineInterface) {
  await disarm($)
  const [list, target, titles] = await Promise.all([read($, items), read($, focused), read($, selected)])
  let picked = pickedFrom(list, titles)
  if (picked.length === 0) {
    picked = list.filter(one => one.title === target)
  }
  if (picked.length === 0) {
    return
  }
  // A failed paste keeps the selection for the retry the toast asks for.
  if (await insertQuote($, quoteItems(list, picked))) {
    await setSelected($, [])
  }
}

async function toggleSelected($: EngineInterface) {
  await disarm($)
  const [list, target, titles] = await Promise.all([read($, items), read($, focused), read($, selected)])
  if (!list.some(one => one.title === target)) {
    return
  }
  const rest = pickedFrom(list, titles).map(one => one.title)
  await setSelected($, rest.includes(target) ? rest.filter(title => title !== target) : [...rest, target])
}

async function toggleAll($: EngineInterface) {
  await disarm($)
  const [list, titles] = await Promise.all([read($, items), read($, selected)])
  if (list.length === 0) {
    return
  }
  const isAll = pickedFrom(list, titles).length === list.length
  await setSelected($, isAll ? [] : list.map(one => one.title))
}

// Asks the built-in /btw about the focused item. It is not awaited: /btw
// resolves only once it has run, which waits for the turn in progress to end.
async function askAbout($: EngineInterface, isWorking: boolean) {
  await disarm($)
  const target = await read($, focused)
  if (!(await read($, items)).some(one => one.title === target)) {
    return
  }
  const args = `Tell me more about this open item from our conversation: "${target}". What is it, why is it still open, and what would close it? Answer in the language of the conversation.`
  $.command.run({ command: 'btw', args }).catch(() => {
    $.ui.toast('Could not ask /btw about this item.')
  })
  if (isWorking) {
    $.ui.toast('The /btw answer will appear once the current turn ends.')
  }
}

// Puts the dot on an item. A delete armed on another item is cancelled, the
// detail view walks from one item's detail to the next, and the window scrolls
// just far enough to show the item.
async function focusItem($: EngineInterface, title: string) {
  const [list, current, shownTitle, armed, start] = await Promise.all([
    read($, items),
    read($, focused),
    read($, detailed),
    read($, deleting),
    read($, windowStart),
  ])
  if (current !== title) {
    await update($, focused, () => title)
  }
  // Start from the window as drawn, which clamps a stale start.
  const drawn = windowFor(list.length, start, list.findIndex(one => one.title === current))
  const scrolled = windowFor(list.length, drawn, list.findIndex(one => one.title === title))
  if (scrolled !== start) {
    await update($, windowStart, () => scrolled)
  }
  if (armed !== '' && armed !== title) {
    await update($, deleting, () => '')
  }
  if (shownTitle !== '' && shownTitle !== title) {
    await update($, detailed, () => title)
  }
}

// Moves the ring to the next or previous row, wrapping around as Tab does. The
// move skips this plugin's own ui.focus hook, so the dot moves here; left
// behind, the leave check would pull the ring back to the old row.
async function moveFocus($: EngineInterface, requestId: string, step: 1 | -1) {
  const [list, current] = await Promise.all([read($, items), read($, focused)])
  const index = list.findIndex(one => one.title === current)
  if (index === -1) {
    return
  }
  const target = (index + step + list.length) % list.length
  const { deny } = await $.ui.focus({ requestId, key: `${ROW_PREFIX}${target}` })
  if (deny === undefined) {
    await focusItem($, list[target]!.title)
  }
}

// Moves the window a page down or up, and the focus with it so the focus keeps
// its row. Like moveFocus, it moves the ring itself.
async function movePage($: EngineInterface, requestId: string, step: 1 | -1) {
  const [list, current, start, shownTitle] = await Promise.all([
    read($, items),
    read($, focused),
    read($, windowStart),
    read($, detailed),
  ])
  const index = list.findIndex(one => one.title === current)
  const page = shownTitle === '' && index !== -1 ? pageFor(list.length, start, index, step) : null
  if (page === null) {
    return
  }
  const { deny } = await $.ui.focus({ requestId, key: `${ROW_PREFIX}${page.index}` })
  if (deny === undefined) {
    // focusItem scrolls the least distance from the old focus, so the page's
    // own start is set after it.
    await focusItem($, list[page.index]!.title)
    await update($, windowStart, () => page.start)
  }
}

// Switches the band between the list and the focused item's detail.
async function toggleDetails($: EngineInterface) {
  await disarm($)
  if ((await read($, detailed)) !== '') {
    await update($, detailed, () => '')
    return
  }
  const target = await read($, focused)
  if ((await read($, items)).some(one => one.title === target)) {
    await update($, detailed, () => target)
  }
}

// The first press arms the focused item; the second deletes it and moves the
// focus to the next item, or the previous one after the last. The ring tracks
// its stop by position, so after the last row goes it may stand on a hotkey
// Button; the leave check puts it back on the focused row.
async function deleteFocused($: EngineInterface) {
  const [list, target] = await Promise.all([read($, items), read($, focused)])
  const index = list.findIndex(one => one.title === target)
  if (index === -1) {
    return
  }
  if ((await read($, deleting)) !== target) {
    await update($, deleting, () => target)
    return
  }
  await tick($, [target])
  await disarm($)
  const title = (list[index + 1] ?? list[index - 1])?.title ?? ''
  await update($, focused, () => title)
  await update($, detailed, shown => (shown === '' ? '' : title))
}

// Resolves to the new list, or null when the list was left as it was. `sent`
// is the list the model was asked about: an item that reached the list after
// that, by a restore, was never judged, so it stays.
async function applyList(
  $: EngineInterface,
  parsed: TodoItem[] | null,
  gen: number,
  sent: readonly TodoItem[],
): Promise<TodoItem[] | null> {
  if (parsed === null || gen !== generation) {
    return null
  }
  const [current, entries] = await Promise.all([read($, items), read($, trash)])
  // Deletes made while the model was thinking win over its reply.
  const blocked = new Set(removedTitles(entries).user)
  const sentTitles = new Set(sent.map(one => one.title))
  const unjudged = current.filter(one => !sentTitles.has(one.title))
  const next = cleanItems([...parsed.filter(one => !blocked.has(one.title)), ...unjudged])
  // Most turns change nothing; writing anyway would redraw the band and rewrite the store.
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    const kept = new Set(next.map(one => one.title))
    await record($, current.filter(one => !kept.has(one.title) && !blocked.has(one.title)), 'model')
    await commit($, next)
  }
  return next
}

async function ask(
  $: EngineInterface,
  gen: number,
  request: {
    system: string
    maxTokens: number
    prompt: (sent: readonly TodoItem[], removed: RemovedTitles) => string
    apply: (text: string, sent: readonly TodoItem[]) => TodoItem[] | null
  },
) {
  try {
    const [sent, entries] = await Promise.all([read($, items), read($, trash)])
    const reply = await $.model.complete({
      model: MODEL,
      effort: 'medium',
      system: request.system,
      prompt: request.prompt(sent, removedTitles(entries)),
      maxTokens: request.maxTokens,
      timeoutMs: COMPLETE_TIMEOUT_MS,
    })
    if (reply.isAnswered) {
      await applyList($, request.apply(reply.text, sent), gen, sent)
    }
  } catch {
    // Keep the previous list.
  }
}

const incremental = ($: EngineInterface, turn: PendingTurn, gen: number) =>
  ask($, gen, {
    system: SYSTEM,
    maxTokens: 8192,
    prompt: (sent, removed) => incrementalPrompt({ ...turn, items: sent, removed }),
    apply: applyChanges,
  })

const reviewList = ($: EngineInterface, turns: readonly ReviewTurn[], gen: number) =>
  ask($, gen, {
    system: REVIEW_SYSTEM,
    maxTokens: 2048,
    prompt: (sent, removed) => reviewPrompt({ items: sent, removed, turns }),
    apply: applyReview,
  })

// Counts a tried turn and runs a review when one is due. The window empties
// when a review is due, whatever its outcome, so a review that keeps failing
// does not retry on every turn.
async function countForReview($: EngineInterface, turn: PendingTurn, gen: number) {
  if (gen !== generation) {
    return
  }
  const [counted, { length }] = await Promise.all([read($, review), read($, items)])
  const turns = [...counted, { userText: turn.userText, answer: turn.answer }]
  const isDue = turns.length >= REVIEW_TURNS || (turns.length >= REVIEW_MIN_TURNS && length >= REVIEW_MIN_ITEMS)
  await update($, review, () => (isDue ? [] : turns))
  if (isDue && length > 0) {
    await reviewList($, turns, gen)
  }
}

// Applies the queued turns oldest first. A turn leaves the queue once tried,
// whatever the outcome, so a reply that never parses cannot retry forever.
async function runPending($: EngineInterface, gen: number) {
  for (;;) {
    const [turn] = await read($, pending)
    if (turn === undefined) {
      return
    }
    await incremental($, turn, gen)
    await update($, pending, turns => turns.slice(1))
    await countForReview($, turn, gen)
  }
}

const schedulePending = ($: EngineInterface) => {
  const gen = generation
  // A timer outlives the dispatch that sets it, so the answer shows without waiting.
  $.clock.after(0, () => {
    void enqueue(() => runPending($, gen))
  })
}

// The band's own keys work only while it holds the focus.
function helpLine(
  isFocused: boolean,
  isArmed: boolean,
  isDetailed: boolean,
  selectedCount: number,
  itemTotal: number,
): string {
  if (!isFocused) {
    return 'Ctrl+X Tab to focus'
  }
  if (isArmed) {
    return `${DELETE_KEY} confirm delete · ${LEAVE_KEY} cancel`
  }
  const pasting = selectedCount > 0 ? `${PASTE_KEY} paste ${selectedCount}` : `${PASTE_KEY} paste`
  const toggle = isDetailed ? 'list' : 'details'
  const paging = itemTotal > WINDOW_SIZE && !isDetailed ? ` · ${NEXT_PAGE_KEY}/${PREVIOUS_PAGE_KEY} page` : ''
  return `${NEXT_KEY}/${PREVIOUS_KEY} move${paging} · ${SELECT_KEY} select · ${SELECT_ALL_KEY} select all · ${pasting} · ${DETAILS_KEY}/${ENTER_KEY} show ${toggle} · ${ASK_KEY} ask /btw · ${DELETE_KEY} delete · ${LEAVE_KEY} leave`
}

const itemCount = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

const refreshFailed = (reason: string) => `Refresh failed (${reason}); the list is unchanged.`

// Applies a refresh reply and reports the outcome, with `note` after a success.
async function settleRefresh(
  $: EngineInterface,
  gen: number,
  sent: readonly TodoItem[],
  reply: { isAnswered: true; text: string } | { isAnswered: false; reason: string },
  note = '',
): Promise<string> {
  if (!reply.isAnswered) {
    return refreshFailed(reply.reason)
  }
  const next = await applyList($, applyRefresh(reply.text, sent), gen, sent)
  return next === null ? refreshFailed('unparseable reply') : `Refreshed the list: ${itemCount(next.length)}.${note}`
}

// The main conversation has nothing to fork right after a resume.
async function refreshFromTranscript(
  $: EngineInterface,
  gen: number,
  sent: readonly TodoItem[],
  removed: RemovedTitles,
): Promise<string> {
  const transcript = renderTranscript(await $.session.messages())
  if (transcript === '') {
    return 'Refresh failed: the main conversation has no messages yet, so there is nothing to refresh from. Send a message and try again.'
  }
  const [model] = await Promise.all([$.session.model(), update($, review, () => [])])
  const reply = await $.model.complete({
    model,
    effort: 'medium',
    prompt: refreshPrompt({ items: sent, removed, transcript }),
    maxTokens: 8192,
    timeoutMs: TRANSCRIPT_TIMEOUT_MS,
  })
  return settleRefresh($, gen, sent, reply, ' It was rebuilt from the transcript without the prompt cache.')
}

async function refresh($: EngineInterface, gen: number): Promise<string> {
  try {
    const [sent, entries] = await Promise.all([read($, items), read($, trash)])
    const removed = removedTitles(entries)
    const reply = await $.model.fork({ prompt: refreshPrompt({ items: sent, removed }) })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
      return await refreshFromTranscript($, gen, sent, removed)
    }
    await update($, review, () => [])
    return await settleRefresh($, gen, sent, reply)
  } catch {
    return 'Refresh failed; the list is unchanged.'
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todos',
      description:
        'Show, refresh, clear or reset the open items list, delete some, list, restore or purge removed items, or send them all with a prompt',
      argumentHint: '[refresh|clear|reset|trash|restore <numbers>|purge <numbers>|delete <numbers>|<prompt>]',
    })

    const now = await $.clock.now()
    const maxAge = await maxAgeMs($)
    for (const key of await $.store.keys()) {
      if (!key.startsWith(STORE_PREFIX)) {
        continue
      }
      const stored = await $.store.get(key)
      if (!isStored(stored) || (maxAge !== null && now - stored.updatedAt > maxAge)) {
        await $.store.delete(key)
      }
    }

    await update($, focused, () => '')
    await update($, deleting, () => '')
    if ((await read($, pending)).length > 0) {
      schedulePending($)
    }

    const mine = await $.store.get(STORE_PREFIX + (await $.session.id()))
    if (isStored(mine)) {
      await update($, items, () => migrate(mine.items))
      await update($, trash, () => loadTrash(mine))
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      generation += 1
      userTexts.clear()
      await update($, lastAnswer, () => '')
      await update($, pending, () => [])
      await update($, items, () => [])
      await update($, trash, () => [])
      await update($, review, () => [])
      await update($, detailed, () => '')
      await update($, deleting, () => '')
      await update($, selected, () => [])
      await $.store.delete(STORE_PREFIX + e.sessionId)
    }

    return next(e)
  })

  // Typing in the prompt box leaves the band without waiting for the leave check.
  on('prompt.edit', async ($, e, next) => {
    await leave($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await leave($)

    return next(e)
  })

  on('turn.start', (_$, e, next) => {
    userTexts.set(e.turnId, e.text)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const userText = userTexts.get(e.turnId) ?? ''
    userTexts.delete(e.turnId)

    if (e.agentId === undefined && e.reason === 'answer') {
      const turn = { previousAnswer: await read($, lastAnswer), userText, answer: e.answer }
      await update($, lastAnswer, () => e.answer)
      await update($, pending, turns => [...turns, turn])
      schedulePending($)
    }

    return next(e)
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    const arg = e.args.trim()

    if (arg === 'refresh') {
      const gen = generation
      return { text: await enqueue(() => refresh($, gen)) }
    }
    if (arg === 'clear') {
      await enqueue(async () => tick($, (await read($, items)).map(one => one.title)))
      return { text: 'Cleared the list.' }
    }
    // Any argument led by one of these words is that subcommand, so a mistyped
    // one is refused instead of going out as a prompt.
    const sub = /^(reset|trash|restore|purge|delete)(?:\s+|$)(.*)$/s.exec(arg)
    if (sub?.[1] === 'reset') {
      if (sub[2] !== '') {
        return { text: 'Usage: /todos reset, with nothing after it. Nothing was changed.' }
      }
      await enqueue(async () => {
        await update($, trash, () => [])
        await update($, review, () => [])
        await commit($, [])
      })
      return { text: 'Emptied the list and the trash.' }
    }
    // Numbered newest first, so `restore 1` takes back the latest removal.
    const newestFirst = async () => [...(await read($, trash))].reverse()
    if (sub?.[1] === 'trash') {
      const removed = await newestFirst()
      if (sub[2] !== '') {
        return { text: 'Usage: /todos trash, with nothing after it.' }
      }
      if (removed.length === 0) {
        return { text: 'The trash is empty.' }
      }
      return { text: ['Trash', ...numberedLines(removed, one => `${one.title} [${one.by}]`)].join('\n') }
    }
    // The trash entries `numbers` picks as `/todos trash` numbers them, or the
    // reply refusing the pick.
    const pickTrash = async (numbers: string, verb: 'restore' | 'purge') => {
      const removed = await newestFirst()
      const parsed = parseNumbers(numbers, removed.length)
      if (parsed === null) {
        return { text: `Usage: /todos ${verb} <numbers>, such as 2, 1-3, or 1,4 6. Nothing was ${verb}d.` }
      }
      if ('missing' in parsed) {
        return { text: `No trash entry ${parsed.missing}. Nothing was ${verb}d.` }
      }
      return {
        picked: parsed.numbers.flatMap(number => {
          const entry = removed[number - 1]
          return entry === undefined ? [] : [{ number, entry }]
        }),
      }
    }
    if (sub?.[1] === 'purge') {
      const pick = await pickTrash(sub[2] ?? '', 'purge')
      if ('text' in pick) {
        return pick
      }
      const gone = new Set(pick.picked.map(one => one.entry.title))
      await update($, trash, entries => entries.filter(one => !gone.has(one.title)))
      await persist($)
      const lines = pick.picked.map(({ number, entry }) => `${number}. ${entry.title}`)
      return { text: [`Purged ${itemCount(pick.picked.length)}:`, ...lines].join('\n') }
    }
    if (sub?.[1] === 'restore') {
      const pick = await pickTrash(sub[2] ?? '', 'restore')
      if ('text' in pick) {
        return pick
      }
      const { picked } = pick
      const current = await read($, items)
      const listed = new Set(current.map(one => one.title))
      const gone = new Set(picked.map(one => one.entry.title))
      const fresh = picked.filter(one => !listed.has(one.entry.title))
      await update($, trash, entries => entries.filter(one => !gone.has(one.title)))
      await commit($, cleanItems([...current, ...picked.map(one => one.entry)]))
      const lines = picked.map(
        ({ number, entry }) => `${number}. ${entry.title}${listed.has(entry.title) ? ' (already on the list)' : ''}`,
      )
      return { text: [`Restored ${itemCount(fresh.length)}:`, ...lines].join('\n') }
    }
    const list = await read($, items)
    if (sub?.[1] === 'delete') {
      const parsed = parseNumbers(sub[2] ?? '', list.length)
      if (parsed === null) {
        return { text: 'Usage: /todos delete <numbers>, such as 2, 1-3, or 1,4 6. Nothing was removed.' }
      }
      if ('missing' in parsed) {
        return { text: `No item ${parsed.missing}. Nothing was removed.` }
      }
      const picked = new Set(parsed.numbers)
      const removed = list.flatMap((one, i) => (picked.has(i + 1) ? [{ number: i + 1, title: one.title }] : []))
      await tick($, removed.map(one => one.title))
      const lines = removed.map(one => `${one.number}. ${one.title}`)
      return { text: [`Removed ${itemCount(removed.length)}:`, ...lines].join('\n') }
    }
    if (arg !== '') {
      if (list.length === 0) {
        return { text: 'No open items; the prompt was not sent.' }
      }
      const text = `${quoteItems(list, list)}\n${arg}`
      // The engine refuses a submit from command.run, which holds the turn the
      // prompt would wait for; a timer sends it once the command has answered.
      $.clock.after(0, () => {
        void $.prompt.submit({ text, asUser: true })
      })
      return { text: `Sent the prompt with ${itemCount(list.length)}.` }
    }

    if (list.length === 0) {
      return { text: 'No open items.' }
    }
    return { text: ['Todos', ...numberedLines(list)].join('\n') }
  })

  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.element === undefined) {
      await leave($)
      return next(e)
    }
    if (e.plugin !== 'todo-list') {
      return next(e)
    }
    const [list, current] = await Promise.all([read($, items), read($, focused)])
    const last = list.length - 1
    let index = Number(e.element.slice(ROW_PREFIX.length))
    // The hidden hotkey Buttons are ring stops too. The event carries no
    // direction, so the handler infers it from the row the ring leaves: Tab
    // off the last row wraps to the first, and Shift+Tab off the first to the
    // last.
    if (!e.element.startsWith(ROW_PREFIX)) {
      index = list[last]?.title === current ? 0 : last
    }
    const item = list[index]
    if (item === undefined) {
      return next(e)
    }
    await focusItem($, item.title)
    watchLeave($, e.requestId)

    return next({ ...e, element: `${ROW_PREFIX}${index}` })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [list, current, openTitle, armed, selectedTitles, storedStart] = await Promise.all([
      read($, items),
      read($, focused),
      read($, detailed),
      read($, deleting),
      read($, selected),
      read($, windowStart),
    ])
    const picked = pickedFrom(list, selectedTitles)
    const { isWorking } = e.props
    // While one item's detail is shown, the band shows that item alone.
    const opened = list.find(one => one.title === openTitle)
    if (list.length === 0 || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const numberWidth = labelWidth(list.length)
    const first = windowFor(list.length, storedStart, list.findIndex(one => one.title === current))
    const after = Math.max(0, list.length - first - WINDOW_SIZE)

    return (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(e.props.bodyColumns)}</Text>
        <Text bold>{GUTTER}Todos</Text>
        {list.map((item, i) => {
          // The focus ring tracks its stop by position, so every row keeps its
          // Button in every view; dropping the hidden rows' Buttons would slide
          // the ring onto the next stop, the first hotkey Button.
          const button = (
            <Button key={`${ROW_PREFIX}${i}`} label=" " plain onPress={() => toggleDetails($)} />
          )
          const isHidden = opened !== undefined ? item !== opened : i < first || i >= first + WINDOW_SIZE
          if (isHidden) {
            return (
              <Box key={`row-${i}`} width={0} height={0} overflow="hidden">
                {button}
              </Box>
            )
          }
          // Items stored before parentheses were normalized still need normalizing here.
          const shown = normalizeParens(item.title)
          const [, main = shown] = NOTE.exec(shown) ?? []
          const room = e.props.bodyColumns - GUTTER.length - numberWidth
          const isFocused = item.title === current
          const color = picked.includes(item) ? SELECTED_COLOR : undefined
          const isLong = !isFocused && opened === undefined && cellWidth(shown) > room
          // The cut may end inside the note.
          const cut = isLong ? fit(shown, room) : shown
          const head = cut.slice(0, main.length)
          const tail = cut.slice(main.length)
          return (
            <Box key={`row-${i}`} flexDirection="row">
              {/* The focus ring always inverts a Button, so the row's Button takes
                  no cells and the dot beside it marks the focus instead. */}
              <Box width={0} overflow="hidden">
                {button}
              </Box>
              <Text>{isFocused ? '• ' : '  '}</Text>
              <Text color={color}>{numberLabel(i + 1, numberWidth)}</Text>
              <Text color={color} wrap={isLong ? 'truncate-end' : 'wrap'}>
                {head}
                {tail !== '' && <Text dimColor>{tail}</Text>}
              </Text>
              {item.title === armed && (
                <Text bold color={DELETE_COLOR}>
                  {' '}
                  delete?
                </Text>
              )}
            </Box>
          )
        })}
        {opened === undefined && after > 0 && (
          <Text dimColor>
            {GUTTER}
            {after} more
          </Text>
        )}
        {opened !== undefined && (
          <Box flexDirection="row">
            <Text>{' '.repeat(GUTTER.length + numberWidth)}</Text>
            <Text wrap="wrap">{opened.detail || '(No detail. Run /todos refresh to add one.)'}</Text>
          </Box>
        )}
        <Box flexDirection="row">
          <Text dimColor>
            {GUTTER}
            {helpLine(current !== '', armed !== '', opened !== undefined, picked.length, list.length)}
          </Text>
          {/* Holds the hotkeys out of sight: a drawn hotkey takes the accent color. */}
          <Box width={0} overflow="hidden">
            <Button key="next" label="next" hotkey={NEXT_KEY} plain onPress={() => moveFocus($, e.requestId, 1)} />
            <Button key="previous" label="previous" hotkey={PREVIOUS_KEY} plain onPress={() => moveFocus($, e.requestId, -1)} />
            <Button key="details" label="details" hotkey={DETAILS_KEY} plain onPress={() => toggleDetails($)} />
            <Button key="next-page" label="next page" hotkey={NEXT_PAGE_KEY} plain onPress={() => movePage($, e.requestId, 1)} />
            <Button key="previous-page" label="previous page" hotkey={PREVIOUS_PAGE_KEY} plain onPress={() => movePage($, e.requestId, -1)} />
            <Button key="paste" label="paste" hotkey={PASTE_KEY} plain onPress={() => paste($)} />
            <Button key="select" label="select" hotkey={SELECT_KEY} plain onPress={() => toggleSelected($)} />
            <Button key="select-all" label="select all" hotkey={SELECT_ALL_KEY} plain onPress={() => toggleAll($)} />
            <Button key="ask" label="ask" hotkey={ASK_KEY} plain onPress={() => askAbout($, isWorking)} />
            <Button key="delete" label="delete" hotkey={DELETE_KEY} plain onPress={() => deleteFocused($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
