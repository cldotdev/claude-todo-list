import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PendingTurn, ReviewTurn, TodoItem, TodoListState, TrashEntry, ViewKind } from '../types'
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
  cellWidth,
  charWidth,
  cleanItems,
  isItem,
  incrementalPrompt,
  normalizeParens,
  parseNumbers,
  prefixLines,
  refreshPrompt,
  renderTranscript,
  removedTitles,
  pageRows,
  reviewPrompt,
  rowWindow,
  wrapRows,
} from './list'
import {
  STORE_CAP,
  type SavedKey,
  keysToDrop,
  legacyId,
  parseKey,
  savedKeyFor,
} from './store'

const MODEL = 'sonnet'
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
// Switches between the band and the pane.
const TOGGLE_KEY = 't'
const PANE_ID = 'todos'
const PANE_TITLE = 'Todos'
// The /config row of the plugin's `default_view` userConfig field.
const DEFAULT_VIEW_KEY = 'todo-list.default_view'
const NO_DETAIL = '(No detail. Run /todos refresh to add one.)'

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
// The pane's own copies of the five band atoms above, plus the position of the
// item it last focused. They last until the pane closes.
const paneFocused = atom({ plugin: 'todo-list', key: 'paneFocused' } as const, '')
const paneFocusIndex = atom({ plugin: 'todo-list', key: 'paneFocusIndex' } as const, 0)
const paneDetailed = atom({ plugin: 'todo-list', key: 'paneDetailed' } as const, '')
const paneDeleting = atom({ plugin: 'todo-list', key: 'paneDeleting' } as const, '')
const paneSelected = atom({ plugin: 'todo-list', key: 'paneSelected' } as const, [] as string[])
const paneWindowStart = atom({ plugin: 'todo-list', key: 'paneWindowStart' } as const, 0)
// Which view shows the list. Session-only: never written to the store. The band
// draws nothing in pane mode.
const mode = atom({ plugin: 'todo-list', key: 'mode' } as const, 'band' as ViewKind)
// Whether this process has applied the default view yet. It lives in $.state so
// a hot reload, which runs session.start again, does not reapply it.
const viewApplied = atom({ plugin: 'todo-list', key: 'viewApplied' } as const, false)
// The last main-loop answer, which the next user message often replies to.
const lastAnswer = atom({ plugin: 'todo-list', key: 'lastAnswer' } as const, '')
// Finished turns not yet applied. They live in $.state, not the module, because
// a hot reload cancels the module's timers: a turn queued as the reload lands
// waits here, and session.start, which runs again after the reload, picks it up.
const pending = atom({ plugin: 'todo-list', key: 'pending' } as const, [] as PendingTurn[])
// The store key this session's entry is saved under now, '' while it has none.
const savedKey = atom({ plugin: 'todo-list', key: 'savedKey' } as const, '')
// Whether the failed-save toast has been shown, so a hot reload does not repeat it.
const failureShown = atom({ plugin: 'todo-list', key: 'failureShown' } as const, false)

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

// A view's atom, reached through closures over `$`: the engine's state scan
// reads only atoms named directly in a `read` or `update` call, and refuses `$`
// passed as an argument.
type Slot<T> = {
  get: () => Promise<T>
  set: (next: (current: T) => T) => Promise<unknown>
}

type Slots = {
  focused: Slot<string>
  detailed: Slot<string>
  deleting: Slot<string>
  selected: Slot<string[]>
  windowStart: Slot<number>
}

// What the actions act on: the band or the pane, each with its own atoms.
type View = Slots & {
  kind: ViewKind
  // The site the focus ring moves on.
  requestId: string
  // The pane only: where its focus last stood.
  focusIndex?: Slot<number>
}

const bandSlots = ($: EngineInterface): Slots => ({
  focused: { get: () => read($, focused), set: next => update($, focused, next) },
  detailed: { get: () => read($, detailed), set: next => update($, detailed, next) },
  deleting: { get: () => read($, deleting), set: next => update($, deleting, next) },
  selected: { get: () => read($, selected), set: next => update($, selected, next) },
  windowStart: { get: () => read($, windowStart), set: next => update($, windowStart, next) },
})

const bandView = ($: EngineInterface, requestId: string): View => ({ ...bandSlots($), kind: 'band', requestId })

const paneView = ($: EngineInterface): View => ({
  kind: 'pane',
  requestId: PANE_ID,
  focused: { get: () => read($, paneFocused), set: next => update($, paneFocused, next) },
  detailed: { get: () => read($, paneDetailed), set: next => update($, paneDetailed, next) },
  deleting: { get: () => read($, paneDeleting), set: next => update($, paneDeleting, next) },
  selected: { get: () => read($, paneSelected), set: next => update($, paneSelected, next) },
  windowStart: { get: () => read($, paneWindowStart), set: next => update($, paneWindowStart, next) },
  focusIndex: { get: () => read($, paneFocusIndex), set: next => update($, paneFocusIndex, next) },
})

// What each view last drew, for its row-based window; key handlers cannot see
// the render's props. `titles` and `details` hold each item's title rows and
// the rows its detail would take expanded (empty for the band, whose items are
// one row each), `rows` the rows left for items, `cap` the most items a window
// holds. Until a view draws, a window of the band's size and the `<n> more` row.
type Drawn = { titles: number[]; details: number[]; rows: number; cap: number }
const undrawn = (cap: number): Drawn => ({ titles: [], details: [], rows: WINDOW_SIZE + 1, cap })
const drawn: Record<ViewKind, Drawn> = { band: undrawn(WINDOW_SIZE), pane: undrawn(Infinity) }

// The view's item heights with the detail expanded on the item titled
// `expandedTitle` ('' for none). An item past the drawn list counts as one row.
const heightsOf = (view: View, list: readonly TodoItem[], expandedTitle: string) => {
  const { titles, details } = drawn[view.kind]
  return list.map((one, i) => (titles[i] ?? 1) + (one.title === expandedTitle ? (details[i] ?? 0) : 0))
}

// Whether a turn is running, as the band last saw it. The pane gets no such prop.
let isWorking = false
// Whether the pane held the keys when it last drew.
let isPaneHeld = false

// The index of the item holding the focus, -1 for none. The pane also keeps the
// position it last focused, so an item that left the list hands the focus to
// the one now there.
function resolveFocus(list: readonly TodoItem[], title: string, stored?: number): number {
  const index = list.findIndex(one => one.title === title)
  return index !== -1 || title === '' || stored === undefined ? index : Math.min(stored, list.length - 1)
}

async function focusOf(view: View, list: readonly TodoItem[]): Promise<number> {
  const [title, stored] = await Promise.all([view.focused.get(), view.focusIndex?.get()])
  return resolveFocus(list, title, stored)
}

async function setSelected(view: Pick<View, 'selected'>, next: string[]) {
  const same = (list: string[]) => list.length === next.length && list.every((title, i) => title === next[i])
  if (!same(await view.selected.get())) {
    await view.selected.set(() => next)
  }
}

async function disarm(view: Pick<View, 'deleting'>) {
  if ((await view.deleting.get()) !== '') {
    await view.deleting.set(() => '')
  }
}

async function clearPane($: EngineInterface) {
  isPaneHeld = false
  await Promise.all([
    update($, paneFocused, () => ''),
    update($, paneFocusIndex, () => 0),
    update($, paneDetailed, () => ''),
    update($, paneDeleting, () => ''),
    update($, paneSelected, () => []),
    update($, paneWindowStart, () => 0),
  ])
}

// What every close of the pane ends with, so the list is never left without a view.
const backToBand = ($: EngineInterface) => Promise.all([clearPane($), update($, mode, () => 'band')])

// A close raised from the pane's own Button does not reach this plugin's
// ui.close hook, so the band comes back here as well.
async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE_ID })
  await backToBand($)
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
  const view = bandSlots($)
  await setSelected(view, [])
  await disarm(view)
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

// Saves run one at a time, apart from `queue`: commit already runs inside queued
// jobs, and the restore and purge commands save outside it.
let saves: Promise<unknown> = Promise.resolve()

function persist($: EngineInterface) {
  const run = saves.then(() => save($))
  saves = run.catch(() => undefined)
  return run
}

// Deletes whole sessions, oldest first, to bring the store down to its target.
async function freeRoom($: EngineInterface, currentId: string) {
  const saved = (await $.store.keys()).flatMap(key => parseKey(key) ?? [])
  for (const key of keysToDrop(saved, currentId)) {
    await $.store.delete(key)
  }
}

// A refusal for size is the only one worth a retry; a changed message turns it
// into a reported failure.
async function setWithRetry($: EngineInterface, currentId: string, key: string, value: unknown) {
  try {
    await $.store.set(key, value)
  } catch (error) {
    if (!String(error).includes(`over the ${STORE_CAP} limit`)) {
      throw error
    }
    await freeRoom($, currentId)
    await $.store.set(key, value)
  }
}

// Writes the new key before deleting the old one, so a crash between them
// leaves two keys for the session instead of none. Failures are reported here,
// so callers carry on as if the save worked.
async function save($: EngineInterface) {
  try {
    const [id, list, entries] = await Promise.all([$.session.id(), read($, items), read($, trash)])
    const state: TodoListState = { items: list, trash: entries }
    const isEmpty = state.items.length === 0 && state.trash.length === 0
    const updatedAt = await $.clock.now()
    const value = { ...state, updatedAt }
    const key = isEmpty ? '' : savedKeyFor(id, updatedAt, JSON.stringify(value).length)
    if (!isEmpty) {
      await setWithRetry($, id, key, value)
    }
    // The swap reads the latest key; a read in another dispatch can be stale.
    let previous = ''
    await update($, savedKey, current => {
      previous = current
      return key
    })
    if (previous !== '' && previous !== key) {
      await $.store.delete(previous)
    }
  } catch (error) {
    $.ui.log(`Could not save the list: ${String(error)}`)
    if (!(await read($, failureShown))) {
      await update($, failureShown, () => true)
      $.ui.toast('List changes are not being saved.')
    }
  }
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
// numbered as in the list.
async function paste($: EngineInterface, view: View) {
  await disarm(view)
  const [list, titles] = await Promise.all([read($, items), view.selected.get()])
  const target = list[await focusOf(view, list)]
  let picked = pickedFrom(list, titles)
  if (picked.length === 0 && target !== undefined) {
    picked = [target]
  }
  if (picked.length === 0) {
    return
  }
  // A failed paste keeps the selection for the retry the toast asks for.
  if (await insertQuote($, quoteItems(list, picked))) {
    await setSelected(view, [])
  }
}

async function toggleSelected($: EngineInterface, view: View) {
  await disarm(view)
  const [list, titles] = await Promise.all([read($, items), view.selected.get()])
  const target = list[await focusOf(view, list)]?.title
  if (target === undefined) {
    return
  }
  const rest = pickedFrom(list, titles).map(one => one.title)
  await setSelected(view, rest.includes(target) ? rest.filter(title => title !== target) : [...rest, target])
}

async function toggleAll($: EngineInterface, view: View) {
  await disarm(view)
  const [list, titles] = await Promise.all([read($, items), view.selected.get()])
  if (list.length === 0) {
    return
  }
  const isAll = pickedFrom(list, titles).length === list.length
  await setSelected(view, isAll ? [] : list.map(one => one.title))
}

// Asks the built-in /btw about the focused item. It is not awaited: /btw
// resolves only once it has run, which waits for the turn in progress to end.
async function askAbout($: EngineInterface, view: View) {
  await disarm(view)
  const list = await read($, items)
  const target = list[await focusOf(view, list)]?.title
  if (target === undefined) {
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

async function setFocus(view: View, title: string, index: number) {
  if ((await view.focused.get()) !== title) {
    await view.focused.set(() => title)
  }
  if (view.focusIndex !== undefined && (await view.focusIndex.get()) !== index) {
    await view.focusIndex.set(() => index)
  }
}

// Puts the dot on the item at `index`. A delete armed on another item is
// cancelled, the detail view walks from one item's detail to the next, and the
// window scrolls just far enough to show the item.
async function focusItem($: EngineInterface, view: View, index: number) {
  const [list, shownTitle, armed, start] = await Promise.all([
    read($, items),
    view.detailed.get(),
    view.deleting.get(),
    view.windowStart.get(),
  ])
  const item = list[index]
  if (item === undefined) {
    return
  }
  const current = await focusOf(view, list)
  await setFocus(view, item.title, index)
  const { rows, cap } = drawn[view.kind]
  // The pane's expansion moves with the focus, so the heights differ before and after.
  const heightsBefore = heightsOf(view, list, shownTitle)
  const heightsAfter = shownTitle === '' ? heightsBefore : heightsOf(view, list, item.title)
  // Start from the window as drawn, which clamps a stale start.
  const before = rowWindow(heightsBefore, start, current, rows, cap)
  const scrolled = rowWindow(heightsAfter, before.start, index, rows, cap).start
  if (scrolled !== start) {
    await view.windowStart.set(() => scrolled)
  }
  if (armed !== '' && armed !== item.title) {
    await view.deleting.set(() => '')
  }
  if (shownTitle !== '' && shownTitle !== item.title) {
    await view.detailed.set(() => item.title)
  }
}

// Moves the ring to the next or previous row, wrapping around as Tab does. The
// move skips this plugin's own ui.focus hook, so the dot moves here; left
// behind, the leave check would pull the ring back to the old row.
async function moveFocus($: EngineInterface, view: View, step: 1 | -1) {
  const list = await read($, items)
  const index = await focusOf(view, list)
  if (index === -1) {
    return
  }
  const target = (index + step + list.length) % list.length
  const { deny } = await $.ui.focus({ requestId: view.requestId, key: `${ROW_PREFIX}${target}` })
  if (deny === undefined) {
    await focusItem($, view, target)
  }
}

// Moves the window a page down or up, and the focus with it so the focus keeps
// its row. Like moveFocus, it moves the ring itself.
async function movePage($: EngineInterface, view: View, step: 1 | -1) {
  const [list, start, shownTitle] = await Promise.all([read($, items), view.windowStart.get(), view.detailed.get()])
  const index = await focusOf(view, list)
  // The band's detail replaces the list; the pane's sits inside it.
  const canPage = index !== -1 && (view.kind === 'pane' || shownTitle === '')
  const { rows, cap } = drawn[view.kind]
  const page = canPage ? pageRows(heightsOf(view, list, shownTitle), start, index, step, rows, cap) : null
  if (page === null) {
    return
  }
  const { deny } = await $.ui.focus({ requestId: view.requestId, key: `${ROW_PREFIX}${page.index}` })
  if (deny === undefined) {
    // focusItem scrolls the least distance from the old focus, so the page's
    // own start is set after it.
    await focusItem($, view, page.index)
    if ((await view.windowStart.get()) !== page.start) {
      await view.windowStart.set(() => page.start)
    }
  }
}

// Switches the band between the list and the focused item's detail, or the
// pane's detail under the focused item.
async function toggleDetails($: EngineInterface, view: View) {
  await disarm(view)
  if ((await view.detailed.get()) !== '') {
    await view.detailed.set(() => '')
    return
  }
  const list = await read($, items)
  const target = list[await focusOf(view, list)]?.title
  if (target !== undefined) {
    await view.detailed.set(() => target)
  }
}

// The first press arms the focused item; the second deletes it and moves the
// focus to the next item, or the previous one after the last. The ring tracks
// its stop by position, so after the last row goes it may stand on a hotkey
// Button; the leave check puts it back on the focused row.
async function deleteFocused($: EngineInterface, view: View) {
  const list = await read($, items)
  const index = await focusOf(view, list)
  const target = list[index]?.title
  if (target === undefined) {
    return
  }
  if ((await view.deleting.get()) !== target) {
    await view.deleting.set(() => target)
    return
  }
  await tick($, [target])
  await disarm(view)
  const nextIndex = list[index + 1] === undefined ? index - 1 : index
  const title = (list[index + 1] ?? list[index - 1])?.title ?? ''
  await setFocus(view, title, Math.max(0, nextIndex))
  await view.detailed.set(shown => (shown === '' ? '' : title))
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

// The keys work only while the view holds the focus.
function helpLine(view: {
  kind: View['kind']
  isHeld: boolean
  isArmed: boolean
  isDetailed: boolean
  selectedCount: number
  hasPages: boolean
}): string {
  if (!view.isHeld) {
    return 'Ctrl+X Tab to focus'
  }
  if (view.isArmed) {
    return `${DELETE_KEY} confirm delete · ${LEAVE_KEY} cancel`
  }
  const isPane = view.kind === 'pane'
  const pasting = view.selectedCount > 0 ? `${PASTE_KEY} paste ${view.selectedCount}` : `${PASTE_KEY} paste`
  const toggle = isPane ? (view.isDetailed ? 'collapse' : 'expand') : view.isDetailed ? 'show list' : 'show details'
  // The band's detail replaces the list, so there is nothing to page.
  const paging = view.hasPages && (isPane || !view.isDetailed) ? ` · ${NEXT_PAGE_KEY}/${PREVIOUS_PAGE_KEY} page` : ''
  const switching = ` · ${TOGGLE_KEY} ${isPane ? 'band' : 'pane'}`
  return `${NEXT_KEY}/${PREVIOUS_KEY} move${paging} · ${SELECT_KEY} select · ${SELECT_ALL_KEY} select all · ${pasting}${switching} · ${DETAILS_KEY}/${ENTER_KEY} ${toggle} · ${ASK_KEY} ask /btw · ${DELETE_KEY} delete · ${LEAVE_KEY} leave`
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

// Reads each legacy `session:<id>` entry once and saves it under the new key
// format. It returns the new key, or null when the entry was deleted (invalid,
// expired, or no newer than a new key) or its save failed.
async function migrateLegacy(
  $: EngineInterface,
  key: string,
  id: string,
  currentId: string,
  current: readonly SavedKey[],
  now: number,
  maxAge: number | null,
): Promise<SavedKey | null> {
  const stored = await $.store.get(key)
  const isKept =
    isStored(stored) &&
    !(maxAge !== null && now - stored.updatedAt > maxAge) &&
    !current.some(one => one.id === id && one.updatedAt >= stored.updatedAt)
  if (!isKept) {
    await $.store.delete(key)
    return null
  }
  const size = JSON.stringify(stored).length
  const migrated = { key: savedKeyFor(id, stored.updatedAt, size), id, updatedAt: stored.updatedAt, size }
  try {
    await setWithRetry($, currentId, migrated.key, stored)
  } catch {
    // The legacy key stays, and the next start tries again.
    return null
  }
  await $.store.delete(key)
  return migrated
}

// Brings the store down to what should be kept, reading key names only, apart
// from each legacy entry. Returns the current session's surviving key.
async function sweep($: EngineInterface, currentId: string): Promise<SavedKey | null> {
  const now = await $.clock.now()
  const maxAge = await maxAgeMs($)
  const keys = await $.store.keys()
  const saved = keys.flatMap(key => parseKey(key) ?? [])
  for (const key of keys) {
    const id = legacyId(key)
    if (id !== null) {
      const migrated = await migrateLegacy($, key, id, currentId, saved, now, maxAge)
      if (migrated !== null) {
        saved.push(migrated)
      }
    }
  }

  // The newest key of each session stays; the rest are older duplicates.
  const newest = new Map<string, SavedKey>()
  for (const one of saved) {
    const best = newest.get(one.id)
    if (best === undefined || one.updatedAt >= best.updatedAt) {
      newest.set(one.id, one)
    }
  }
  const kept: SavedKey[] = []
  for (const one of saved) {
    if (newest.get(one.id) !== one || (maxAge !== null && now - one.updatedAt > maxAge)) {
      await $.store.delete(one.key)
    } else {
      kept.push(one)
    }
  }
  for (const key of keysToDrop(kept, currentId)) {
    await $.store.delete(key)
  }
  return kept.find(one => one.id === currentId) ?? null
}

type Elements = ReturnType<EngineInterface['ui']['resolve']>

// Opening an open pane only retitles it, but its focus request is still
// granted from an empty prompt, which hands the keys to the pane. The band
// hides only once the pane is drawn, so the list always has a view. An open
// nobody asked for takes no keys: they would turn the first letters typed into
// the pane's hotkeys.
async function openPane($: EngineInterface, takesKeys = true): Promise<boolean> {
  const { isPlaced } = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, ...(takesKeys && { focus: true as const }) })
  if (isPlaced) {
    await update($, mode, () => 'pane')
  }
  return isPlaced
}

// The `default_view` setting; band for a missing or unreadable row.
async function defaultView($: EngineInterface): Promise<ViewKind> {
  try {
    const row = (await $.config.list()).find(one => one.key === DEFAULT_VIEW_KEY)
    return row?.value === 'pane' ? 'pane' : 'band'
  } catch {
    return 'band'
  }
}

// A view's window and its help line, drawn to fit. The help line wraps and names
// the paging keys only when the list does not fit, so it is drawn once without
// them and, if the list still does not fit, again with. `fit` gets the rows the
// view's lines take apart from the items, and answers the window.
function fitWindow<W extends { count: number }>(view: {
  columns: number
  length: number
  // The rows the view's own lines take apart from the help line and the items.
  fixedRows: number
  helpFor: (hasPages: boolean) => string
  fit: (others: number) => W
}): { window: W; help: string } {
  const attempt = (hasPages: boolean) => {
    const help = view.helpFor(hasPages)
    return { help, window: view.fit(view.fixedRows + wrapRows(`${GUTTER}${help}`, view.columns)) }
  }
  const whole = attempt(false)
  return view.length > whole.window.count ? attempt(true) : whole
}

// The rows a title takes beyond its first once the focused item shows it whole.
const extraTitleRows = (title: string | undefined, columns: number, numberWidth: number) =>
  title === undefined ? 0 : wrapRows(normalizeParens(title), columns - GUTTER.length - numberWidth) - 1

// One item's row, drawn by the band and the pane alike. The focus ring tracks
// its stop by position, so a hidden row keeps its Button.
function itemRow(
  { Box, Button, Text }: Elements,
  row: {
    item: TodoItem
    index: number
    numberWidth: number
    columns: number
    isShown: boolean
    // Whether the focus dot is drawn.
    isFocused: boolean
    // Whether the title is drawn whole instead of cut to one row.
    isWhole: boolean
    isPicked: boolean
    isArmed: boolean
    autoFocus?: true
    onPress: () => void
  },
) {
  const button = (
    <Button key={`${ROW_PREFIX}${row.index}`} label=" " plain autoFocus={row.autoFocus} onPress={row.onPress} />
  )
  if (!row.isShown) {
    return (
      <Box key={`row-${row.index}`} width={0} height={0} overflow="hidden">
        {button}
      </Box>
    )
  }
  // Items stored before parentheses were normalized still need normalizing here.
  const shown = normalizeParens(row.item.title)
  const [, main = shown] = NOTE.exec(shown) ?? []
  const room = row.columns - GUTTER.length - row.numberWidth
  const color = row.isPicked ? SELECTED_COLOR : undefined
  const isLong = !row.isWhole && cellWidth(shown) > room
  // The cut may end inside the note.
  const cut = isLong ? fit(shown, room) : shown
  const head = cut.slice(0, main.length)
  const tail = cut.slice(main.length)
  return (
    <Box key={`row-${row.index}`} flexDirection="row">
      {/* The focus ring always inverts a Button, so the row's Button takes
          no cells and the dot beside it marks the focus instead. */}
      <Box width={0} overflow="hidden">
        {button}
      </Box>
      <Text>{row.isFocused ? '• ' : '  '}</Text>
      <Text color={color}>{numberLabel(row.index + 1, row.numberWidth)}</Text>
      <Text color={color} wrap={isLong ? 'truncate-end' : 'wrap'}>
        {head}
        {tail !== '' && <Text dimColor>{tail}</Text>}
      </Text>
      {row.isArmed && (
        <Text weight="semibold" color={DELETE_COLOR}>
          {' '}
          delete?
        </Text>
      )}
    </Box>
  )
}

// The hidden hotkey Buttons both views bind to their own view.
function keyButtons($: EngineInterface, { Button }: Elements, view: View) {
  return [
    <Button key="next" label="next" hotkey={NEXT_KEY} plain onPress={() => moveFocus($, view, 1)} />,
    <Button key="previous" label="previous" hotkey={PREVIOUS_KEY} plain onPress={() => moveFocus($, view, -1)} />,
    <Button key="details" label="details" hotkey={DETAILS_KEY} plain onPress={() => toggleDetails($, view)} />,
    <Button key="next-page" label="next page" hotkey={NEXT_PAGE_KEY} plain onPress={() => movePage($, view, 1)} />,
    <Button key="previous-page" label="previous page" hotkey={PREVIOUS_PAGE_KEY} plain onPress={() => movePage($, view, -1)} />,
    <Button key="paste" label="paste" hotkey={PASTE_KEY} plain onPress={() => paste($, view)} />,
    <Button key="select" label="select" hotkey={SELECT_KEY} plain onPress={() => toggleSelected($, view)} />,
    <Button key="select-all" label="select all" hotkey={SELECT_ALL_KEY} plain onPress={() => toggleAll($, view)} />,
    <Button key="ask" label="ask" hotkey={ASK_KEY} plain onPress={() => askAbout($, view)} />,
    <Button key="delete" label="delete" hotkey={DELETE_KEY} plain onPress={() => deleteFocused($, view)} />,
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todos',
      description:
        'Show, refresh, clear or reset the open items list, open it in a pane, delete some, list, restore or purge removed items, or send them all with a prompt',
      argumentHint: '[refresh|clear|pane|reset|trash|restore <numbers>|purge <numbers>|delete <numbers>|<prompt>]',
    })

    const id = await $.session.id()
    const mine = await sweep($, id)

    await update($, focused, () => '')
    await update($, deleting, () => '')
    if ((await read($, pending)).length > 0) {
      schedulePending($)
    }

    if (mine !== null) {
      await update($, savedKey, () => mine.key)
      const stored = await $.store.get(mine.key)
      if (isStored(stored)) {
        await update($, items, () => migrate(stored.items))
        await update($, trash, () => loadTrash(stored))
      }
    }

    // Only the first start of the process applies the default view: a reload
    // runs this hook again, and /clear fires no start at all.
    if (!(await read($, viewApplied))) {
      await update($, viewApplied, () => true)
      if ((await defaultView($)) === 'pane') {
        await openPane($, false)
      }
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
      await clearPane($)
      await update($, savedKey, () => '')
      for (const key of await $.store.keys()) {
        if ((parseKey(key)?.id ?? legacyId(key)) === e.sessionId) {
          await $.store.delete(key)
        }
      }
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
    if (arg === 'pane') {
      return { text: (await openPane($)) ? 'The Todos pane is open.' : 'The Todos pane cannot be shown here.' }
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
    const view = bandView($, e.requestId)
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
    if (list[index] === undefined) {
      return next(e)
    }
    await focusItem($, view, index)
    watchLeave($, e.requestId)

    return next({ ...e, element: `${ROW_PREFIX}${index}` })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Recorded before any early return, so the pane's ask key sees it even
    // while the band draws nothing.
    isWorking = e.props.isWorking
    const [isPaneMode, list, current, openTitle, armed, selectedTitles, storedStart] = await Promise.all([
      read($, mode).then(one => one === 'pane'),
      read($, items),
      read($, focused),
      read($, detailed),
      read($, deleting),
      read($, selected),
      read($, windowStart),
    ])
    const picked = pickedFrom(list, selectedTitles)
    // While one item's detail is shown, the band shows that item alone.
    const opened = list.find(one => one.title === openTitle)
    if (isPaneMode || list.length === 0 || e.props.hasSurvey) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const view = bandView($, e.requestId)
    const { bodyColumns: columns } = e.props
    const numberWidth = labelWidth(list.length)
    const focusIndex = resolveFocus(list, current)
    const {
      window: { start: first, count: size },
      help,
    } = fitWindow({
      columns,
      length: list.length,
      // The rule and the heading.
      fixedRows: 2 + extraTitleRows(list[focusIndex]?.title, columns, numberWidth),
      fit: others => {
        const rows = e.props.maxRows - others
        // A window that leaves items out keeps its size at the end of the list,
        // where it would have a spare row for one more.
        const isWhole = list.length <= WINDOW_SIZE && list.length <= rows
        const cap = isWhole ? WINDOW_SIZE : Math.max(1, Math.min(WINDOW_SIZE, rows - 1))
        drawn.band = { titles: [], details: [], rows, cap }
        return rowWindow(
          list.map(() => 1),
          storedStart,
          focusIndex,
          rows,
          cap,
        )
      },
      helpFor: hasPages =>
        helpLine({
          kind: 'band',
          isHeld: current !== '',
          isArmed: armed !== '',
          isDetailed: opened !== undefined,
          selectedCount: picked.length,
          hasPages,
        }),
    })
    const after = Math.max(0, list.length - first - size)

    return (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(columns)}</Text>
        <Text weight="semibold">{GUTTER}Todos</Text>
        {list.map((item, i) => {
          const isFocused = item.title === current
          return itemRow(ui, {
            item,
            index: i,
            numberWidth,
            columns,
            isShown: opened !== undefined ? item === opened : i >= first && i < first + size,
            isFocused,
            isWhole: isFocused || opened !== undefined,
            isPicked: picked.includes(item),
            isArmed: item.title === armed,
            onPress: () => toggleDetails($, view),
          })
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
            <Text wrap="wrap">{opened.detail || NO_DETAIL}</Text>
          </Box>
        )}
        <Box flexDirection="row">
          <Text dimColor>
            {GUTTER}
            {help}
          </Text>
          {/* Holds the hotkeys out of sight: a drawn hotkey takes the accent color. */}
          <Box width={0} overflow="hidden">
            {keyButtons($, ui, view)}
            <Button key="pane" label="pane" hotkey={TOGGLE_KEY} plain onPress={() => openPane($)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.element === undefined || e.plugin !== 'todo-list') {
      return next(e)
    }
    const view = paneView($)
    const list = await read($, items)
    const last = list.length - 1
    const held = await focusOf(view, list)
    // The pane's first stop after it lacked the keys: back on the item it left,
    // with a delete armed before it left cancelled.
    const isEntering = !isPaneHeld
    isPaneHeld = true
    if (isEntering) {
      await disarm(view)
    }
    let index = Number(e.element.slice(ROW_PREFIX.length))
    if (isEntering && held !== -1) {
      index = held
    } else if (!e.element.startsWith(ROW_PREFIX)) {
      // As the band does, infer the direction from the row the ring leaves.
      index = held === last ? 0 : last
    }
    if (list[index] === undefined) {
      return next(e)
    }
    await focusItem($, view, index)

    return next({ ...e, element: `${ROW_PREFIX}${index}` })
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const isHeld = e.props.isFocused
    isPaneHeld = isHeld
    const [list, current, storedIndex, openTitle, armed, selectedTitles, storedStart] = await Promise.all([
      read($, items),
      read($, paneFocused),
      read($, paneFocusIndex),
      read($, paneDetailed),
      read($, paneDeleting),
      read($, paneSelected),
      read($, paneWindowStart),
    ])
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const view = paneView($)
    const toggle = <Button key="band" label="band" hotkey={TOGGLE_KEY} plain onPress={() => closePane($)} />
    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text weight="semibold">{GUTTER}Todos</Text>
          <Text dimColor>{GUTTER}No open items.</Text>
          <Box width={0} overflow="hidden">
            {toggle}
          </Box>
        </Box>
      )
    }

    const picked = pickedFrom(list, selectedTitles)
    const opened = list.find(one => one.title === openTitle)
    const { bodyColumns: columns } = e.props
    const numberWidth = labelWidth(list.length)
    const focusIndex = resolveFocus(list, current, storedIndex)
    const room = columns - GUTTER.length - numberWidth
    const titles = list.map(one => wrapRows(normalizeParens(one.title), room))
    const details = list.map(one => wrapRows(one.detail || NO_DETAIL, room))
    const heights = titles.map((rows, i) => rows + (list[i] === opened ? details[i]! : 0))
    const {
      window: { start: first, count: size },
      help,
    } = fitWindow({
      columns,
      length: list.length,
      // The heading.
      fixedRows: 1,
      fit: others => {
        const rows = e.props.scroll.bodyRows - others
        drawn.pane = { titles, details, rows, cap: Infinity }
        return rowWindow(heights, storedStart, focusIndex, rows)
      },
      helpFor: hasPages =>
        helpLine({
          kind: 'pane',
          isHeld,
          isArmed: armed !== '',
          isDetailed: opened !== undefined,
          selectedCount: picked.length,
          hasPages,
        }),
    })
    const after = Math.max(0, list.length - first - size)
    // Without an autoFocus row the ring starts on nothing when the pane takes
    // the keys, so no ui.focus sets a focus and the keys have no item to act on.
    const ringStart = focusIndex === -1 ? first : focusIndex

    return (
      <Box flexDirection="column">
        <Text weight="semibold">{GUTTER}Todos</Text>
        {list.flatMap((item, i) => {
          // Without the keys the pane keeps its focus but draws no dot.
          const isFocused = isHeld && i === focusIndex
          const isShown = i >= first && i < first + size
          const row = itemRow(ui, {
            item,
            index: i,
            numberWidth,
            columns,
            isShown,
            isFocused,
            isWhole: true,
            isPicked: picked.includes(item),
            isArmed: isHeld && item.title === armed,
            autoFocus: i === ringStart ? true : undefined,
            onPress: () => toggleDetails($, view),
          })
          if (!isShown || item !== opened) {
            return [row]
          }
          return [
            row,
            <Box key={`detail-${i}`} flexDirection="row">
              <Text>{' '.repeat(GUTTER.length + numberWidth)}</Text>
              <Text wrap="wrap">{item.detail || NO_DETAIL}</Text>
            </Box>,
          ]
        })}
        {after > 0 && (
          <Text dimColor>
            {GUTTER}
            {after} more
          </Text>
        )}
        <Box flexDirection="row">
          <Text dimColor>
            {GUTTER}
            {help}
          </Text>
          <Box width={0} overflow="hidden">
            {keyButtons($, ui, view)}
            {toggle}
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    await backToBand($)

    return next(e)
  })
}
