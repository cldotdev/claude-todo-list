import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PendingTurn, TodoItem, TodoListState } from '../types'
import {
  MAX_DONE,
  SYSTEM,
  applyChanges,
  isItem,
  incrementalPrompt,
  normalizeParens,
  parseItems,
  parseNumbers,
  prefixLines,
  refreshPrompt,
} from './list'

const MODEL = 'sonnet'
const STORE_PREFIX = 'session:'
const DAY_MS = 24 * 60 * 60 * 1000
// Claude Code's own default for cleanupPeriodDays.
const DEFAULT_CLEANUP_DAYS = 30
const COMPLETE_TIMEOUT_MS = 60_000
// Rows take no hotkey: a digit hotkey also fires from an empty prompt, so a
// message starting with "1." would quote the first item. A letter fires only
// while the band holds the focus.
const NEXT_KEY = 'j'
const PREVIOUS_KEY = 'k'
const DETAILS_KEY = 'o'
const SELECT_KEY = 's'
const SELECT_ALL_KEY = 'a'
const PASTE_KEY = 'p'
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
const done = atom({ plugin: 'todo-list', key: 'done' } as const, [])
// Titles: the item the band's focus ring stands on ('' while the ring is
// outside the band), and the item whose detail the band shows.
const focused = atom({ plugin: 'todo-list', key: 'focused' } as const, '')
const detailed = atom({ plugin: 'todo-list', key: 'detailed' } as const, '')
// The title of the item the first delete press armed; the next press deletes it.
const deleting = atom({ plugin: 'todo-list', key: 'deleting' } as const, '')
// Titles of the items picked for a paste. Session-only: never written to the store.
const selected = atom({ plugin: 'todo-list', key: 'selected' } as const, [] as string[])
// The last main-loop answer, which the next user message often replies to.
const lastAnswer = atom({ plugin: 'todo-list', key: 'lastAnswer' } as const, '')
// Finished turns not yet applied. They live in $.state, not the module, because
// a hot reload cancels the module's timers: a turn queued as the reload lands
// waits here, and session.start, which runs again after the reload, picks it up.
const pending = atom({ plugin: 'todo-list', key: 'pending' } as const, [] as PendingTurn[])

// An entry saved before items had a detail holds plain strings.
type Stored = { items: (string | TodoItem)[]; done: string[]; updatedAt: number }

const isStored = (value: unknown): value is Stored =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Stored).items) &&
  (value as Stored).items.every(one => typeof one === 'string' || isItem(one)) &&
  Array.isArray((value as Stored).done) &&
  typeof (value as Stored).updatedAt === 'number'

const migrate = (stored: (string | TodoItem)[]): TodoItem[] =>
  stored.map(one => (typeof one === 'string' ? { title: one, detail: '' } : one))

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

// The dot, the selection, a pending delete, and the detail view last only
// while the band holds the focus.
async function leave($: EngineInterface) {
  const [current, shown] = await Promise.all([read($, focused), read($, detailed)])
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
  const key = STORE_PREFIX + (await $.session.id())
  const state: TodoListState = {
    items: await read($, items),
    done: await read($, done),
  }
  if (state.items.length === 0 && state.done.length === 0) {
    await $.store.delete(key)
    return
  }
  await $.store.set(key, { ...state, updatedAt: await $.clock.now() })
}

async function commit($: EngineInterface, next: TodoItem[]) {
  await update($, items, () => next)
  await persist($)
}

async function tick($: EngineInterface, titles: readonly string[]) {
  const ticked = new Set(titles)
  await update($, items, list => list.filter(one => !ticked.has(one.title)))
  await update($, done, list => [...list.filter(one => !ticked.has(one)), ...titles].slice(-MAX_DONE))
  await persist($)
}

// `1. ` through `10. `, padded to the widest number so every title starts in
// one column.
const labelWidth = (last: number) => `${last}.`.length + 1
const numberLabel = (number: number, width: number) => `${number}.`.padEnd(width)

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

// Puts the dot on an item. A delete armed on another item is cancelled, and
// the detail view walks from one item's detail to the next.
async function focusItem($: EngineInterface, title: string) {
  const [current, shownTitle, armed] = await Promise.all([read($, focused), read($, detailed), read($, deleting)])
  if (current !== title) {
    await update($, focused, () => title)
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

// Resolves to the new list, or null when the list was left as it was.
async function applyList(
  $: EngineInterface,
  parsed: TodoItem[] | null,
  gen: number,
): Promise<TodoItem[] | null> {
  if (parsed === null || gen !== generation) {
    return null
  }
  // Ticks made while the model was thinking win over its reply.
  const ticked = new Set(await read($, done))
  const next = parsed.filter(one => !ticked.has(one.title))
  // Most turns change nothing; writing anyway would redraw the band and rewrite the store.
  if (JSON.stringify(next) !== JSON.stringify(await read($, items))) {
    await commit($, next)
  }
  return next
}

async function incremental($: EngineInterface, turn: PendingTurn, gen: number) {
  try {
    const sent = await read($, items)
    const reply = await $.model.complete({
      model: MODEL,
      effort: 'medium',
      system: SYSTEM,
      prompt: incrementalPrompt({ ...turn, items: sent, done: await read($, done) }),
      maxTokens: 8192,
      timeoutMs: COMPLETE_TIMEOUT_MS,
    })
    if (reply.isAnswered) {
      await applyList($, applyChanges(reply.text, sent), gen)
    }
  } catch {
    // Keep the previous list.
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
function helpLine(isFocused: boolean, isArmed: boolean, isDetailed: boolean, selectedCount: number): string {
  if (!isFocused) {
    return 'Ctrl+x Tab to focus'
  }
  if (isArmed) {
    return `${DELETE_KEY} confirm delete · ${LEAVE_KEY} cancel`
  }
  const pasting = selectedCount > 0 ? `${PASTE_KEY} paste ${selectedCount}` : `${PASTE_KEY} paste`
  const toggle = isDetailed ? 'list' : 'details'
  return `${NEXT_KEY}/${PREVIOUS_KEY} move · ${SELECT_KEY} select · ${SELECT_ALL_KEY} select all · ${pasting} · ${DETAILS_KEY}/${ENTER_KEY} show ${toggle} · ${ASK_KEY} ask /btw · ${DELETE_KEY} delete · ${LEAVE_KEY} leave`
}

const itemCount = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

async function refresh($: EngineInterface, gen: number): Promise<string> {
  try {
    const reply = await $.model.fork({ prompt: refreshPrompt(await read($, done)) })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
      return 'Refresh failed: the main conversation has not answered since startup or /clear, so there is nothing to fork. Send a message and try again.'
    }
    if (!reply.isAnswered) {
      return `Refresh failed (${reply.reason}); the list is unchanged.`
    }
    const next = await applyList($, parseItems(reply.text), gen)
    return next === null
      ? 'Refresh failed (unparseable reply); the list is unchanged.'
      : `Refreshed the list: ${itemCount(next.length)}.`
  } catch {
    return 'Refresh failed; the list is unchanged.'
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todos',
      description: 'Show, refresh or clear the open items list, delete some, or send them all with a prompt',
      argumentHint: '[refresh|clear|delete <numbers>|<prompt>]',
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
      await update($, done, () => mine.done)
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
      await update($, done, () => [])
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
      await enqueue(() => commit($, []))
      return { text: 'Cleared the list.' }
    }
    const list = await read($, items)
    // Any argument led by the word delete is a delete, so a mistyped number
    // list is refused instead of going out as a prompt.
    const deleteMatch = /^delete(?:\s+|$)(.*)$/s.exec(arg)
    if (deleteMatch !== null) {
      const parsed = parseNumbers(deleteMatch[1] ?? '', list.length)
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
    const width = labelWidth(list.length)
    const lines = list.flatMap((one, i) => {
      const title = `${numberLabel(i + 1, width)}${one.title}`
      return one.detail === '' ? [title] : [title, prefixLines(one.detail, ' '.repeat(width))]
    })
    return { text: ['Todos', ...lines].join('\n') }
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
    const [list, current, openTitle, armed, selectedTitles] = await Promise.all([
      read($, items),
      read($, focused),
      read($, detailed),
      read($, deleting),
      read($, selected),
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
          if (opened !== undefined && item !== opened) {
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
        {opened !== undefined && (
          <Box flexDirection="row">
            <Text>{' '.repeat(GUTTER.length + numberWidth)}</Text>
            <Text wrap="wrap">{opened.detail || '(No detail. Run /todos refresh to add one.)'}</Text>
          </Box>
        )}
        <Box flexDirection="row">
          <Text dimColor>
            {GUTTER}
            {helpLine(current !== '', armed !== '', opened !== undefined, picked.length)}
          </Text>
          {/* Holds the hotkeys out of sight: a drawn hotkey takes the accent color. */}
          <Box width={0} overflow="hidden">
            <Button key="next" label="next" hotkey={NEXT_KEY} plain onPress={() => moveFocus($, e.requestId, 1)} />
            <Button key="previous" label="previous" hotkey={PREVIOUS_KEY} plain onPress={() => moveFocus($, e.requestId, -1)} />
            <Button key="details" label="details" hotkey={DETAILS_KEY} plain onPress={() => toggleDetails($)} />
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
