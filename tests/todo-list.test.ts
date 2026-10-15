import { expect, mock, test } from 'claude-code/testing'
import type { Engine, EngineCall, MockClock, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { TrashEntry } from '../types'
import {
  MAX_DETAIL_LENGTH,
  MAX_TRASH,
  REVIEW_MIN_ITEMS,
  REVIEW_MIN_TURNS,
  REVIEW_TURNS,
  TRANSCRIPT_TEXT,
  TRANSCRIPT_TOOL_RESULT_TEXT,
  pageRows,
  rowWindow,
  wrapRows,
} from '../hooks/list'
import { STORE_CAP, STORE_TARGET, parseKey, storeLength } from '../hooks/store'

const USAGE = { input_tokens: 1, output_tokens: 1 } as never
const BAND = {
  plugin: 'todo-list',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80 } as never,
} as const

type Reply = ({ isAnswered: true; text: string } | { isAnswered: false; reason: string }) & {
  // Runs while the request waits for its reply.
  during?: () => Promise<unknown>
}

// The next queued reply, or a failure once they run out.
async function nextReply(replies: Reply[]) {
  const { during, ...reply } = replies.shift() ?? { isAnswered: false, reason: 'empty-reply' }
  await during?.()
  return { value: { usage: USAGE, ...reply } as never }
}

function setup(
  on: On,
  replies: Reply[],
  stored: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
  store: (on: On, entries: Record<string, unknown>) => void = mock.store,
) {
  const asked: string[] = []
  const models: string[] = []
  const filled: string[] = []
  const submitted: string[] = []
  const landed: (string | undefined)[] = []
  const ran: { command: string; args: string }[] = []
  const toasts: string[] = []
  const logs: string[] = []
  // The plugin's `$.ui.open` and `$.ui.close` calls.
  const opened: unknown[] = []
  const closed: unknown[] = []
  // What the next `$.ui.open` answers; a test sets it false for a surface without panes.
  const placement = { isPlaced: true }
  const clock = mock.clock(on)
  store(on, stored)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('command.run', (_$, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e)
    return {
      value: placement.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no room for a pane' },
    }
  })
  on('ui.close', (_$, e) => {
    closed.push(e)
    return { value: undefined }
  })
  on('prompt.edit', (_$, e) => e as never)
  on('ui.render', $ => h($.ui.resolve(BAND).Text, null, 'engine band') as never)
  on('session.id', () => ({ value: 's1' }))
  on('settings.read', () => ({ value: settings }))
  on('ui.focus', (_$, e) => {
    landed.push(e.element)
    return {}
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('command.register', () => ({ value: { command: 'todos' } }))
  on('model.complete', async (_$, e) => {
    asked.push(e.prompt)
    models.push(e.model)
    return nextReply(replies)
  })
  return { asked, models, clock, filled, landed, ran, submitted, toasts, logs, opened, closed, placement }
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

async function turn($: Engine, clock: MockClock, e: Record<string, unknown>) {
  await $.turn.start({ text: 'ask', turnId: 't1' })
  await $.turn.complete({
    answer: 'reply',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...e,
  })
  await clock.advance(0)
}

async function drawnOf(ui: Mounted<'terminal', 'AbovePrompt'>) {
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const buttons = (await ui.findAll({ type: 'Button' })).length
  await ui.unmount()
  return { texts, buttons }
}

const expectBandHidden = async ($: Engine) =>
  expect(await drawnOf(await $.ui.mount({ ...BAND, props: bandProps(20), requestId: 'band' }))).toEqual({
    texts: ['engine band'],
    buttons: 0,
  })

const expectBandShown = async ($: Engine) =>
  expect((await bandAt($, 20).then(drawnOf)).buttons).toBeGreaterThan(0)

const shown = ($: Engine) => $.ui.mount(BAND).then(drawnOf)

test('a normal answer updates the list and draws the band', async ($, on) => {
  const { asked, clock } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"補跑測試","detail":"d-補跑測試"},{"title":"確認設計","detail":"d-確認設計"}]}' }])
  await start($)
  await turn($, clock, {})
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('ask')
  const { texts, buttons } = await shown($)
  expect(texts.map(one => one.trim())).toContain('Todos')
  expect(buttons).toBe(13)
})

test('subagent and aborted turns are skipped', async ($, on) => {
  const { asked, clock } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"x","detail":"d-x"}]}' }])
  await start($)
  await turn($, clock, { agentId: 'a1' })
  await turn($, clock, { reason: 'aborted', isAborted: true })
  await turn($, clock, { reason: 'error' })
  expect(asked).toHaveLength(0)
  expect((await shown($)).texts).toEqual(['engine band'])
})

test('a failed or unparseable completion keeps the previous list', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"}]}' },
    { isAnswered: false, reason: 'api-error' },
    { isAnswered: true, text: 'not json' },
    { isAnswered: true, text: '{"remove":[9],"add":[]}' },
  ])
  await start($)
  for (let i = 0; i < 4; i += 1) {
    await turn($, clock, {})
  }
  const { texts, buttons } = await shown($)
  expect(texts.map(one => one.trim())).toContain('Todos')
  expect(buttons).toBe(12)
})

// Moves the band's focus ring onto one of its Buttons, as Tab would.
const focusOn = ($: Engine, element: string) =>
  $.ui.focus({
    component: 'AbovePrompt',
    requestId: 'band',
    plugin: 'todo-list',
    element,
    origin: { kind: 'person' },
  })

const focusRow = ($: Engine, row: number) => focusOn($, `item-${row}`)

const origin = { kind: 'plugin', name: 'test' } as never
const presentation = { isFullscreen: false, columns: 80 } as never

test('the paste key pastes the focused item, numbered as in the band, when nothing is selected', async ($, on) => {
  const { clock, filled } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":"d-b"}]}' }])
  await start($)
  await turn($, clock, {})

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await focusRow($, 1)
  await ui.press({ key: 'paste' })
  await ui.unmount()
  expect(filled).toEqual(['> 2. b\n>    d-b\n\n'])
  expect((await shown($)).buttons).toBe(13)
})

test('the focus ring skips the hidden hotkey Buttons and wraps around the rows', async ($, on) => {
  const { clock, landed } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":""},{"title":"b","detail":""},{"title":"c","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await focusRow($, 2)
  await focusOn($, 'details')
  await focusOn($, 'select-all')
  await ui.unmount()
  expect(landed).toEqual(['item-2', 'item-0', 'item-2'])
})

test('/todos delete removes an item, records it and keeps it from coming back', async ($, on) => {
  const { asked, clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":"d-b"}]}' },
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":"d-b"}]}' },
  ])
  await start($)
  await turn($, clock, {})

  const removed = await $.command.run({ command: 'todos', args: 'delete 1', origin, presentation })
  expect(removed.text).toBe('Removed 1 item:\n1. a')
  expect((await shown($)).buttons).toBe(12)

  await turn($, clock, {})
  expect(asked[1]).toContain('Items the user removed')
  expect(asked[1]).toContain('["a"]')
  expect((await shown($)).buttons).toBe(12)
})

test('the band shows every item', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"1","detail":"d-1"},{"title":"2","detail":"d-2"},{"title":"3","detail":"d-3"},{"title":"4","detail":"d-4"},{"title":"5","detail":"d-5"},{"title":"6","detail":"d-6"},{"title":"7","detail":"d-7"}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const { texts, buttons } = await shown($)
  expect(buttons).toBe(18)
  expect(texts.map(one => one.trim())).toContain('Todos')
})

test('/todos lists and clears', async ($, on) => {
  const { clock } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"}]}' }])
  await start($)
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toContain('1. a\n   d-a')
  await $.command.run({ command: 'todos', args: 'clear', origin, presentation })
  const empty = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(empty.text).toBe('No open items.')
})

test('a detail-less item pastes only its numbered title', async ($, on) => {
  const { clock, filled } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":""}]}' }])
  await start($)
  await turn($, clock, {})
  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await focusRow($, 0)
  await ui.press({ key: 'paste' })
  await ui.unmount()
  expect(filled).toEqual(['> 1. a\n\n'])
})

test('a reply with string items keeps the previous list', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"x"}]}' },
    { isAnswered: true, text: '{"remove":[],"add":["b"]}' },
  ])
  await start($)
  await turn($, clock, {})
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. a\n   x')
})

test('stored string items migrate to items without a detail', async ($, on) => {
  setup(on, [], {
    'session:s1': { items: ['old', { title: 'new', detail: 'x' }], trash: [], updatedAt: Date.now() },
  })
  await start($)
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. old\n2. new\n   x')
})

const DAY_MS = 24 * 60 * 60 * 1000

// Resumes a session whose list was last saved 40 days ago, and lists it.
async function listAfter40Days($: Engine, on: On, settings: Record<string, unknown>) {
  const saved = { items: [{ title: 'a', detail: '' }], trash: [], updatedAt: 0 }
  const { clock } = setup(on, [], { 'session:s1': saved }, settings)
  await clock.set(40 * DAY_MS)
  await start($)
  return (await $.command.run({ command: 'todos', args: '', origin, presentation })).text
}

test('a saved list lasts as long as cleanupPeriodDays', async ($, on) => {
  expect(await listAfter40Days($, on, { cleanupPeriodDays: 60 })).toBe('Todos\n1. a')
})

test('a saved list expires after 30 days when cleanupPeriodDays is unset', async ($, on) => {
  expect(await listAfter40Days($, on, {})).toBe('No open items.')
})

test('an invalid cleanupPeriodDays keeps saved lists', async ($, on) => {
  expect(await listAfter40Days($, on, { cleanupPeriodDays: 0 })).toBe('Todos\n1. a')
})

test('the details key and Enter switch the band to the focused item and its detail, and back', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})

  const band = await $.ui.mount({ ...BAND, requestId: 'band' })
  // Nothing is focused yet, so the press changes nothing.
  await band.press({ key: 'details' })
  await focusRow($, 0)
  await band.press({ key: 'details' })
  await band.unmount()
  const opened = (await shown($)).texts
  expect(opened).toContain('d-a')
  expect(opened).not.toContain('b')

  // Enter presses the focused row's Button.
  const again = await $.ui.mount({ ...BAND, requestId: 'band' })
  await again.press({ key: 'item-0' })
  await again.unmount()
  expect((await shown($)).texts).not.toContain('d-a')
})

test('/todos with a prompt sends every item and the prompt to the model', async ($, on) => {
  const { clock, submitted } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const sent = await $.command.run({ command: 'todos', args: '先做哪一項？', origin, presentation })
  expect(sent.text).toBe('Sent the prompt with 2 items.')
  await clock.advance(0)
  expect(submitted).toEqual(['> 1. a\n>    d-a\n>\n> 2. b\n\n先做哪一項？'])
})

test('/todos delete takes ranges and space- or comma-separated numbers', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":""},{"title":"b","detail":""},{"title":"c","detail":""},{"title":"d","detail":""},{"title":"e","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const removed = await $.command.run({ command: 'todos', args: 'delete 1-2, 4 2', origin, presentation })
  expect(removed.text).toBe('Removed 3 items:\n1. a\n2. b\n4. d')
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. c\n2. e')
})

test('a malformed or out-of-range /todos delete removes and sends nothing', async ($, on) => {
  const { clock, submitted } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":""},{"title":"b","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})
  for (const args of ['delete', 'delete 1~2', 'delete 2-1', 'delete 0']) {
    const reply = await $.command.run({ command: 'todos', args, origin, presentation })
    expect(reply.text).toStartWith('Usage:')
  }
  const missing: Record<string, string> = { 'delete 1-500': '3', 'delete 1, 500': '500', 'delete 500 4': '4' }
  for (const [args, number] of Object.entries(missing)) {
    const reply = await $.command.run({ command: 'todos', args, origin, presentation })
    expect(reply.text).toBe(`No item ${number}. Nothing was removed.`)
  }
  await clock.advance(0)
  expect(submitted).toEqual([])
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. a\n2. b')
})

test('a detail is kept up to the cap and cut beyond it', async ($, on) => {
  const long = 'x'.repeat(MAX_DETAIL_LENGTH + 50)
  const { clock } = setup(on, [
    { isAnswered: true, text: JSON.stringify({ remove: [], add: [{ title: 'a', detail: long }] }) },
  ])
  await start($)
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe(`Todos\n1. a\n   ${'x'.repeat(MAX_DETAIL_LENGTH)}`)
})

const MULTI = JSON.stringify({
  remove: [],
  add: [{ title: 'a\nb', detail: 'first  point\r\n\r\n  second\tpoint \r third' }],
})

test('a detail keeps its lines, each normalized, while a title stays one line', async ($, on) => {
  const { clock } = setup(on, [{ isAnswered: true, text: MULTI }])
  await start($)
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. a b\n   first point\n   second point\n   third')
})

test('a detail cut at the cap leaves no trailing newline or space', async ($, on) => {
  const cut = `${'x'.repeat(MAX_DETAIL_LENGTH - 1)}\ny`
  const { clock } = setup(on, [
    { isAnswered: true, text: JSON.stringify({ remove: [], add: [{ title: 'a', detail: cut }] }) },
  ])
  await start($)
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe(`Todos\n1. a\n   ${'x'.repeat(MAX_DETAIL_LENGTH - 1)}`)
})

test('a paste quotes every line of a detail, aligned under its title', async ($, on) => {
  const { filled, band } = await bandWith($, on, MULTI)
  await focusRow($, 0)
  await band.press({ key: 'paste' })
  await band.unmount()
  expect(filled).toEqual(['> 1. a b\n>    first point\n>    second point\n>    third\n\n'])
})

test('the prompt to the model indents every line of a detail', async ($, on) => {
  const { asked, clock } = await bandWith($, on, MULTI, [{ isAnswered: true, text: '{"remove":[],"add":[]}' }])
  await turn($, clock, {})
  expect(asked[1]).toContain('Current list:\n1. a b\n   first point\n   second point\n   third')
})

test('the details view shows every line of a detail', async ($, on) => {
  const { band } = await bandWith($, on, MULTI)
  await focusRow($, 0)
  await band.press({ key: 'details' })
  await band.unmount()
  expect((await shown($)).texts).toContain('first point\nsecond point\nthird')
})

const THREE = '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":"d-b"},{"title":"c","detail":"d-c"}]}'

// Starts a band over the items and returns the helpers the delete tests share.
async function bandWith($: Engine, on: On, json: string, replies: Reply[] = []) {
  const ctx = setup(on, [{ isAnswered: true, text: json }, ...replies])
  await start($)
  await turn($, ctx.clock, {})
  const band = await $.ui.mount({ ...BAND, requestId: 'band' })
  const listed = async () =>
    ((await $.command.run({ command: 'todos', args: '', origin, presentation })).text ?? '').split('\n').slice(1)
  return { ...ctx, band, listed }
}

type Drawn = Mounted<'terminal', 'AbovePrompt'> | Mounted<'terminal', 'Pane'>

// The title text of the row the dot marks.
async function dotted(band: Drawn) {
  const texts = (await band.findAll({ type: 'Text' })).map(one => one.text)
  const at = texts.indexOf('• ')
  return at === -1 ? undefined : texts[at + 2]
}

test('the delete key arms on the first press and deletes on the second, recording the title', async ($, on) => {
  const { asked, clock, band, listed } = await bandWith($, on, THREE, [{ isAnswered: true, text: THREE }])
  await focusRow($, 1)
  await band.press({ key: 'delete' })
  expect(await listed()).toEqual(['1. a', '   d-a', '2. b', '   d-b', '3. c', '   d-c'])
  expect((await shown($)).texts.join('|')).toContain('delete?')
  expect((await shown($)).texts.join('|')).toContain('d confirm delete · Esc cancel')
  await band.press({ key: 'delete' })
  expect(await listed()).toEqual(['1. a', '   d-a', '2. c', '   d-c'])
  expect((await shown($)).texts.join('|')).not.toContain('delete?')
  await band.unmount()

  await turn($, clock, {})
  expect(asked[1]).toContain('Items the user removed')
  expect(asked[1]).toContain('["b"]')
})

test('moving the focus or pressing another band key between the two presses cancels the delete', async ($, on) => {
  const { filled, band, listed } = await bandWith($, on, THREE)
  await focusRow($, 0)
  await band.press({ key: 'delete' })
  await focusRow($, 1)
  await band.press({ key: 'delete' })
  expect(await listed()).toHaveLength(6)
  await band.press({ key: 'select' })
  await band.press({ key: 'delete' })
  expect(await listed()).toHaveLength(6)
  expect(filled).toHaveLength(0)
  await band.press({ key: 'delete' })
  expect(await listed()).toHaveLength(4)
  await band.unmount()
})

test('editing the prompt cancels a pending delete', async ($, on) => {
  const { band, listed } = await bandWith($, on, THREE)
  await focusRow($, 0)
  await band.press({ key: 'delete' })
  // The kit raises prompt.edit, but its typings leave `edit` off `$.prompt`.
  const prompt = $.prompt as typeof $.prompt & { edit: EngineCall<'prompt.edit'> }
  await prompt.edit({ text: 'x', inputText: 'x', cursor: 1, start: 1, end: 1 } as never)
  await focusRow($, 0)
  await band.press({ key: 'delete' })
  expect(await listed()).toHaveLength(6)
  await band.unmount()
})

test('deleting a middle item focuses the next one, and the last item the previous one', async ($, on) => {
  const { clock, band, listed } = await bandWith($, on, THREE)
  await focusRow($, 1)
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  expect(await dotted(band)).toBe('c')

  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  expect(await dotted(band)).toBe('a')
  expect(await listed()).toEqual(['1. a', '   d-a'])
  await band.unmount()
})

test('deleting the only item removes the band', async ($, on) => {
  const { clock, band } = await bandWith($, on, '{"remove":[],"add":[{"title":"a","detail":""}]}')
  await focusRow($, 0)
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  await band.unmount()
  expect((await shown($)).texts).toEqual(['engine band'])
})

test('deleting in the details view shows the next item detail', async ($, on) => {
  const { clock, band } = await bandWith($, on, THREE)
  await focusRow($, 0)
  await band.press({ key: 'details' })
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  await band.unmount()
  const texts = (await shown($)).texts
  expect(texts).toContain('d-b')
  expect(texts).not.toContain('d-a')
})

test('the delete key does nothing while no item is focused', async ($, on) => {
  const { band, listed } = await bandWith($, on, THREE)
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await band.unmount()
  expect(await listed()).toHaveLength(6)
})

test('the help line shows only the focus key until the band holds the focus', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  const help = async () => (await band.findAll({ type: 'Text' })).map(one => one.text).at(-1)?.trim()
  expect(await help()).toBe('Ctrl+X Tab to focus')
  await focusRow($, 0)
  expect(await help()).not.toContain('Ctrl+X Tab')
  expect(await help()).toContain('Esc leave')
  expect(await help()).not.toContain('Shift+Tab')
  await band.unmount()
})

// The kit has no ring to answer the band's own leave check, so the ring
// leaving the band stands in for Esc; both end the same way.
test('leaving the band takes it from the details view back to the list', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  await focusRow($, 0)
  await band.press({ key: 'details' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } })
  const texts = (await band.findAll({ type: 'Text' })).map(one => one.text.trim())
  await band.unmount()
  expect(texts).not.toContain('d-a')
  expect(texts).toContain('b')
  expect(texts).toContain('Ctrl+X Tab to focus')
})

const FIVE = JSON.stringify({
  remove: [],
  add: ['a', 'b', 'c', 'd', 'e'].map(title => ({ title, detail: `d-${title}` })),
})

// Selected rows color their number.
const marks = async (band: Drawn) =>
  (await band.findAll({ type: 'Text', text: /^\d+\. *$/ })).filter(one => one.props.color !== undefined).length

const helpOf = async (band: Drawn) =>
  (await band.findAll({ type: 'Text' })).map(one => one.text).at(-1)?.trim()

test('the select key toggles the focused item and marks it', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(0)
  await focusRow($, 1)
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(1)
  expect(await helpOf(band)).toContain('v paste 1')
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(0)
  expect(await helpOf(band)).toContain('v paste ·')
  await band.unmount()
})

test('the select-all key selects every item and a second press clears them', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  await band.press({ key: 'select-all' })
  expect(await marks(band)).toBe(3)
  await band.press({ key: 'select-all' })
  expect(await marks(band)).toBe(0)
  await band.unmount()
})

test('the paste key pastes the selected items in list order with their band numbers, then clears the selection', async ($, on) => {
  const { filled, band } = await bandWith($, on, FIVE)
  await focusRow($, 4)
  await band.press({ key: 'select' })
  await focusRow($, 1)
  await band.press({ key: 'select' })
  expect(await helpOf(band)).toContain('v paste 2')
  await band.press({ key: 'paste' })
  expect(filled).toEqual(['> 2. b\n>    d-b\n>\n> 5. e\n>    d-e\n\n'])
  expect(await marks(band)).toBe(0)
  expect(await dotted(band)).toBe('b')
  await band.unmount()
})

test('a selected item that is deleted drops out of the paste', async ($, on) => {
  const { clock, filled, band } = await bandWith($, on, THREE)
  await band.press({ key: 'select-all' })
  await focusRow($, 1)
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  expect(await marks(band)).toBe(2)
  expect(await helpOf(band)).toContain('v paste 2')
  await band.press({ key: 'paste' })
  expect(filled).toEqual(['> 1. a\n>    d-a\n>\n> 2. c\n>    d-c\n\n'])
  await band.unmount()
})

test('leaving the band clears the selection', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  await focusRow($, 0)
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(1)
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } })
  expect(await marks(band)).toBe(0)
  await band.unmount()
})

test('the ask key runs /btw about the focused title, and toasts while Claude is working', async ($, on) => {
  const { clock, ran, toasts } = setup(on, [{ isAnswered: true, text: THREE }])
  await start($)
  await turn($, clock, {})

  const band = await $.ui.mount({ ...BAND, requestId: 'band' })
  await band.press({ key: 'ask' })
  expect(ran).toEqual([])
  await focusRow($, 1)
  await band.press({ key: 'ask' })
  await clock.advance(0)
  await band.unmount()
  expect(ran).toHaveLength(1)
  expect(ran[0]?.command).toBe('btw')
  expect(ran[0]?.args).toContain('"b"')
  expect(ran[0]?.args).not.toContain('d-b')
  expect(toasts).toEqual([])

  const busy = await $.ui.mount({ ...BAND, props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80 } as never, requestId: 'band' })
  await busy.press({ key: 'ask' })
  await clock.advance(0)
  await busy.unmount()
  expect(ran).toHaveLength(2)
  expect(toasts).toHaveLength(1)
})

test('numbers are padded so the titles under 1. and 11. start in one column', async ($, on) => {
  const titles = [...'abcdefghijk']
  const json = JSON.stringify({ remove: [], add: titles.map(title => ({ title, detail: `d-${title}` })) })
  const { filled, band, listed } = await bandWith($, on, json)
  await focusRow($, 10)
  await band.press({ key: 'select' })
  await focusRow($, 1)
  await band.press({ key: 'select' })
  await band.press({ key: 'paste' })
  await band.unmount()
  expect(filled).toEqual(['> 2.  b\n>     d-b\n>\n> 11. k\n>     d-k\n\n'])
  const lines = await listed()
  expect(lines[0]).toBe('1.  a')
  expect(lines[20]).toBe('11. k')
})

const listOf = (count: number) =>
  JSON.stringify({
    remove: [],
    add: Array.from({ length: count }, (_, i) => ({ title: `t${i + 1}`, detail: `d-t${i + 1}` })),
  })

// The item numbers the band draws, and the `<n> more` line when there is one.
async function windowOf(band: Drawn) {
  const texts = (await band.findAll({ type: 'Text' })).map(one => one.text.trim())
  return {
    numbers: texts.filter(one => /^\d+\.$/.test(one)).map(one => parseInt(one, 10)),
    more: texts.find(one => / more$/.test(one)),
  }
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

test('the band shows a 10-item window with the count of the items after it', async ($, on) => {
  const { band } = await bandWith($, on, listOf(25))
  expect(await windowOf(band)).toEqual({ numbers: range(1, 10), more: '15 more' })
  await focusRow($, 24)
  expect(await windowOf(band)).toEqual({ numbers: range(16, 25), more: undefined })
  await band.unmount()
})

test('a short list shows whole with no more line', async ($, on) => {
  const { band } = await bandWith($, on, listOf(7))
  expect(await windowOf(band)).toEqual({ numbers: range(1, 7), more: undefined })
  await band.unmount()
})

test('focus moves scroll the window by the least distance', async ($, on) => {
  const { band } = await bandWith($, on, listOf(25))
  await focusRow($, 9)
  await focusRow($, 10)
  expect(await dotted(band)).toBe('t11')
  expect((await windowOf(band)).numbers).toEqual(range(2, 11))

  await focusRow($, 1)
  expect(await dotted(band)).toBe('t2')
  expect((await windowOf(band)).numbers).toEqual(range(2, 11))
  await focusRow($, 0)
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))

  await focusRow($, 24)
  expect((await windowOf(band)).numbers).toEqual(range(16, 25))
  await focusRow($, 0)
  expect(await dotted(band)).toBe('t1')
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))
  await band.unmount()
})

const ones = (length: number) => Array.from({ length }, () => 1)

test('paging stays full, moves by up to 10 items, and keeps the focus row', () => {
  expect(pageRows(ones(25), 0, 4, 1, 11, 10)).toEqual({ start: 10, index: 14 })
  expect(pageRows(ones(25), 10, 14, 1, 11, 10)).toEqual({ start: 15, index: 19 })
  expect(pageRows(ones(25), 15, 19, 1, 11, 10)).toBeNull()
  expect(pageRows(ones(25), 5, 7, -1, 11, 10)).toEqual({ start: 0, index: 2 })
  expect(pageRows(ones(25), 0, 4, -1, 11, 10)).toBeNull()
  expect(pageRows(ones(7), 0, 3, 1, 11, 10)).toBeNull()
  // A stale start is read as the window drawn around the focus.
  expect(pageRows(ones(25), 0, 24, -1, 11, 10)).toEqual({ start: 5, index: 14 })
})

test('the paging keys change nothing at an edge of the list', async ($, on) => {
  const { band } = await bandWith($, on, listOf(25))
  await focusRow($, 4)
  await band.press({ key: 'previous-page' })
  expect(await dotted(band)).toBe('t5')
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))
  await band.unmount()
})

test('the paging keys change nothing on a list of 10 items or fewer', async ($, on) => {
  const { band } = await bandWith($, on, listOf(10))
  await focusRow($, 3)
  await band.press({ key: 'next-page' })
  await band.press({ key: 'previous-page' })
  expect(await dotted(band)).toBe('t4')
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))
  await band.unmount()
})

test('the paging keys change nothing in the details view', async ($, on) => {
  const { band } = await bandWith($, on, listOf(25))
  await focusRow($, 4)
  await band.press({ key: 'details' })
  expect((await windowOf(band)).more).toBeUndefined()
  await band.press({ key: 'next-page' })
  expect((await band.findAll({ type: 'Text' })).map(one => one.text.trim())).toContain('d-t5')
  await band.press({ key: 'details' })
  expect(await dotted(band)).toBe('t5')
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))
  await band.unmount()
})

test('the paste key is v and the paging keys are n and p', async ($, on) => {
  const { band, filled } = await bandWith($, on, listOf(11))
  const buttons = await band.findAll({ type: 'Button' })
  const hotkeys = Object.fromEntries(buttons.map(one => [one.props.label, one.props.hotkey]))
  expect(hotkeys).toMatchObject({ 'next page': 'n', 'previous page': 'p', paste: 'v' })
  await focusRow($, 2)
  await band.press({ key: 'previous-page' })
  expect(filled).toEqual([])
  await band.unmount()
})

test('the help line names the paging keys only while the list holds more than 10 items', async ($, on) => {
  const long = await bandWith($, on, listOf(11))
  await focusRow($, 0)
  expect(await helpOf(long.band)).toContain('n/p page')
  expect(await helpOf(long.band)).toContain('v paste')
  expect(await helpOf(long.band)).toContain('t pane')
  await long.band.unmount()
})

test('the help line leaves the paging keys out in the details view', async ($, on) => {
  const { band } = await bandWith($, on, listOf(11))
  await focusRow($, 0)
  await band.press({ key: 'details' })
  expect(await helpOf(band)).not.toContain('n/p page')
  await band.unmount()
})

test('the help line leaves the paging keys out at 10 items', async ($, on) => {
  const { band } = await bandWith($, on, listOf(10))
  await focusRow($, 0)
  expect(await helpOf(band)).toContain('v paste')
  expect(await helpOf(band)).not.toContain('n/p page')
  await band.unmount()
})

test('leaving the band puts the window back at the top', async ($, on) => {
  const { band } = await bandWith($, on, listOf(25))
  await focusRow($, 14)
  expect((await windowOf(band)).numbers).toEqual(range(6, 15))
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } })
  expect((await windowOf(band)).numbers).toEqual(range(1, 10))
  await band.unmount()
})

test('a delete in the last window pulls the window up so it stays full', async ($, on) => {
  const { clock, band } = await bandWith($, on, listOf(25))
  await focusRow($, 24)
  await focusRow($, 19)
  await band.press({ key: 'delete' })
  await band.press({ key: 'delete' })
  await clock.advance(0)
  expect(await windowOf(band)).toEqual({ numbers: range(15, 24), more: undefined })
  await band.unmount()
})

const NOOP = '{"remove":[],"add":[]}'
const answered = (text: string): Reply => ({ isAnswered: true, text })
const adding = (...titles: string[]) =>
  answered(JSON.stringify({ remove: [], add: titles.map(title => ({ title, detail: `d-${title}` })) }))
const removing = (...numbers: number[]) => answered(JSON.stringify({ remove: numbers, add: [] }))

const run = ($: Engine, args: string) =>
  $.command.run({ command: 'todos', args, origin, presentation }).then(reply => reply.text)

// Answers `/todos refresh` with the given replies, and records the prompts.
function mockFork(on: On, replies: Reply[]) {
  const forked: string[] = []
  on('model.fork', (_$, e) => {
    forked.push(e.prompt)
    return nextReply(replies)
  })
  return forked
}

// Completes `count` answered turns, each with its own answer.
async function turns($: Engine, clock: MockClock, count: number, from = 1) {
  for (let i = from; i < from + count; i += 1) {
    await turn($, clock, { answer: `answer-${i}` })
  }
}

const SIX = ['a', 'b', 'c', 'd', 'e', 'f']
const noops = (count: number) => Array.from({ length: count }, () => answered(NOOP))

test(`${REVIEW_TURNS} turns on a short list trigger a review that sees every turn`, async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), ...noops(REVIEW_TURNS - 1), removing(1)])
  await start($)
  await turns($, clock, REVIEW_TURNS - 1)
  expect(asked).toHaveLength(REVIEW_TURNS - 1)
  await turns($, clock, 1, REVIEW_TURNS)
  expect(asked).toHaveLength(REVIEW_TURNS + 1)
  for (let i = 1; i <= REVIEW_TURNS; i += 1) {
    expect(asked.at(-1)).toContain(`Turn ${i} of ${REVIEW_TURNS}`)
    expect(asked.at(-1)).toContain(`answer-${i}`)
  }
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('Trash\n1. a [model]\n   d-a')
})

test(`${REVIEW_MIN_TURNS} turns trigger a review once the list holds ${REVIEW_MIN_ITEMS} items`, async ($, on) => {
  const { asked, clock } = setup(on, [adding(...SIX), ...noops(REVIEW_MIN_TURNS - 1), removing(2, 4)])
  await start($)
  await turns($, clock, REVIEW_MIN_TURNS - 1)
  expect(asked).toHaveLength(REVIEW_MIN_TURNS - 1)
  await turns($, clock, 1, REVIEW_MIN_TURNS)
  expect(asked).toHaveLength(REVIEW_MIN_TURNS + 1)
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. c\n   d-c\n3. e\n   d-e\n4. f\n   d-f')
  expect(await run($, 'trash')).toBe('Trash\n1. d [model]\n   d-d\n2. b [model]\n   d-b')
})

test('an empty list skips the review and the count starts again', async ($, on) => {
  const { asked, clock } = setup(on, [
    ...Array.from({ length: REVIEW_TURNS }, () => answered('not json')),
    adding('a'),
    ...noops(REVIEW_TURNS - 1),
    removing(1),
  ])
  await start($)
  await turns($, clock, REVIEW_TURNS)
  expect(asked).toHaveLength(REVIEW_TURNS)
  await turns($, clock, REVIEW_TURNS, REVIEW_TURNS + 1)
  expect(asked).toHaveLength(REVIEW_TURNS * 2 + 1)
  expect(asked.at(-1)).toContain(`Turn 1 of ${REVIEW_TURNS}`)
})

test('subagent and aborted turns are not counted toward a review', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), ...noops(REVIEW_TURNS - 2)])
  await start($)
  await turns($, clock, REVIEW_TURNS - 1)
  await turn($, clock, { agentId: 'a1' })
  await turn($, clock, { reason: 'aborted', isAborted: true })
  expect(asked).toHaveLength(REVIEW_TURNS - 1)
})

test('refresh and /todos reset restart the review count', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), ...noops(REVIEW_TURNS * 2)])
  const forked = mockFork(on, [answered(NOOP)])
  await start($)
  await turns($, clock, REVIEW_TURNS - 1)
  expect(await run($, 'refresh')).toBe('Refreshed the list: 1 item.')
  expect(forked).toHaveLength(1)
  await turns($, clock, 1, REVIEW_TURNS)
  expect(asked).toHaveLength(REVIEW_TURNS)

  await turns($, clock, REVIEW_TURNS - 2, REVIEW_TURNS + 1)
  expect(await run($, 'reset')).toBe('Emptied the list and the trash.')
  await turns($, clock, 1, 2 * REVIEW_TURNS)
  expect(asked).toHaveLength(REVIEW_TURNS * 2 - 1)
})

test('a malformed or out-of-range review reply keeps the list and the trash', async ($, on) => {
  const { clock } = setup(on, [
    adding('a', 'b'),
    ...noops(REVIEW_TURNS - 1),
    removing(3),
    ...noops(REVIEW_TURNS - 1),
    answered('not json'),
  ])
  await start($)
  await turns($, clock, REVIEW_TURNS)
  await turns($, clock, REVIEW_TURNS, REVIEW_TURNS + 1)
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b')
  expect(await run($, 'trash')).toBe('The trash is empty.')
})

test('a review cannot add items', async ($, on) => {
  const { clock } = setup(on, [
    adding('a'),
    ...noops(REVIEW_TURNS - 1),
    answered('{"remove":[],"add":[{"title":"z","detail":"d"}]}'),
  ])
  await start($)
  await turns($, clock, REVIEW_TURNS)
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
})

test('a delete made while the review waits stays a user removal', async ($, on) => {
  const { clock } = setup(on, [
    adding('a', 'b'),
    ...noops(REVIEW_TURNS - 1),
    { ...removing(1), during: () => run($, 'delete 1') },
  ])
  await start($)
  await turns($, clock, REVIEW_TURNS)
  expect(await run($, '')).toBe('Todos\n1. b\n   d-b')
  expect(await run($, 'trash')).toBe('Trash\n1. a [user]\n   d-a')
})

test('an item restored while the review waits stays on the list', async ($, on) => {
  const { clock } = setup(on, [...noops(REVIEW_TURNS), { ...removing(1, 2), during: () => run($, 'restore 1') }], {
    'session:s1': {
      items: [{ title: 'a', detail: 'd-a' }, { title: 'b', detail: 'd-b' }],
      trash: [entry('x', 'user')],
      updatedAt: Date.now(),
    },
  })
  await start($)
  await turns($, clock, REVIEW_TURNS)
  expect(await run($, '')).toBe('Todos\n1. x\n   d-x')
  expect(await run($, 'trash')).toBe('Trash\n1. b [model]\n   d-b\n2. a [model]\n   d-a')
})

test('the prompts carry the titles the user removed and the model removed apart', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a', 'b', 'c'), removing(2), answered(NOOP)])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1')
  await turn($, clock, {})
  await turn($, clock, {})
  expect(asked[2]).toContain('Items the user removed (never add them back):\n["a"]')
  expect(asked[2]).toContain('do not add them back unless the conversation reopens them):\n["c"]')
})

test('a title the model removed can come back, and a later delete leaves one user entry', async ($, on) => {
  const { clock } = setup(on, [adding('a'), removing(1), adding('a')])
  await start($)
  await turns($, clock, 2)
  expect(await run($, 'trash')).toBe('Trash\n1. a [model]\n   d-a')
  await turns($, clock, 1, 3)
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
  await run($, 'delete 1')
  expect(await run($, 'trash')).toBe('Trash\n1. a [user]\n   d-a')
})

const entry = (title: string, by: TrashEntry['by']) => ({ title, detail: `d-${title}`, by, at: 1 })

test('each source keeps its own newest entries in the trash', async ($, on) => {
  const old = Array.from({ length: MAX_TRASH }, (_, i) => entry(`m${i}`, 'model'))
  const users = ['u0', 'u1', 'u2'].map(title => entry(title, 'user'))
  const { clock } = setup(on, [removing(1)], {
    'session:s1': { items: [{ title: 'x', detail: '' }], trash: [...users, ...old], updatedAt: Date.now() },
  })
  await start($)
  await turn($, clock, {})
  // Title lines only: every entry here but x carries a detail line.
  const lines = ((await run($, 'trash')) ?? '').split('\n').filter(line => / \[(user|model)\]$/.test(line))
  expect(lines).toHaveLength(MAX_TRASH + users.length)
  expect(lines[0]).toContain('x [model]')
  expect(lines).not.toContain(expect.stringContaining('m0 '))
  expect(lines.filter(one => one.endsWith('[user]'))).toHaveLength(users.length)
})

test('a saved trash comes back on resume', async ($, on) => {
  setup(on, [], {
    'session:s1': { items: [], trash: [entry('a', 'user'), entry('b', 'model')], updatedAt: Date.now() },
  })
  await start($)
  expect(await run($, 'trash')).toBe('Trash\n1. b [model]\n   d-b\n2. a [user]\n   d-a')
})

test('a legacy done list becomes user entries that keep their titles off the list', async ($, on) => {
  const { clock } = setup(on, [adding('A')], { 'session:s1': { items: [], done: ['A'], updatedAt: Date.now() } })
  await start($)
  expect(await run($, 'trash')).toBe('Trash\n1. A [user]')
  await turn($, clock, {})
  expect(await run($, '')).toBe('No open items.')
})

test('a stored entry with neither trash nor done is not loaded', async ($, on) => {
  setup(on, [], { 'session:s1': { items: [{ title: 'a', detail: '' }], updatedAt: Date.now() } })
  await start($)
  expect(await run($, '')).toBe('No open items.')
})

test('/todos clear moves every item to the trash as a user removal', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b', 'c')])
  await start($)
  await turn($, clock, {})
  expect(await run($, 'clear')).toBe('Cleared the list.')
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('Trash\n1. c [user]\n   d-c\n2. b [user]\n   d-b\n3. a [user]\n   d-a')
})

test('/todos clear waits for a pending reply, which then lands in the trash as a user removal', async ($, on) => {
  let cleared: Promise<string | undefined> | undefined
  // Not awaited: the clear is queued behind this very reply.
  const clear = async () => {
    cleared = run($, 'clear')
  }
  const { clock } = setup(on, [{ ...adding('a'), during: clear }])
  await start($)
  await turn($, clock, {})
  expect(await cleared).toBe('Cleared the list.')
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('Trash\n1. a [user]\n   d-a')
})

test('/todos trash lists newest first, says when empty and refuses extra text', async ($, on) => {
  const { clock, submitted } = setup(on, [adding('a', 'b'), removing(1)])
  await start($)
  expect(await run($, 'trash')).toBe('The trash is empty.')
  await turn($, clock, {})
  await run($, 'delete 1')
  await turn($, clock, {})
  expect(await run($, 'trash')).toBe('Trash\n1. b [model]\n   d-b\n2. a [user]\n   d-a')
  expect(await run($, 'trash all')).toStartWith('Usage:')
  await clock.advance(0)
  expect(submitted).toEqual([])
})

test('/todos restore puts items back, lifts the user block and skips a title already listed', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b'), adding('a', 'b'), adding('c')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1-2')
  expect(await run($, 'restore 2')).toBe('Restored 1 item:\n2. a')
  expect(await run($, 'trash')).toBe('Trash\n1. b [user]\n   d-b')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')

  await turn($, clock, {})
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
  await run($, 'delete 1')
  expect(await run($, 'restore 1-2')).toBe('Restored 2 items:\n1. a\n2. b')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b')

  await run($, 'clear')
  await run($, 'restore 1')
  await turn($, clock, {})
  expect(await run($, '')).toBe('Todos\n1. b\n   d-b\n2. c\n   d-c')
})

test('/todos restore counts only the items added and marks a title already listed', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b'), removing(1), adding('a')])
  await start($)
  await turns($, clock, 3)
  await run($, 'delete 1')
  expect(await run($, 'trash')).toBe('Trash\n1. b [user]\n   d-b\n2. a [model]\n   d-a')
  expect(await run($, 'restore 1-2')).toBe('Restored 1 item:\n1. b\n2. a (already on the list)')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b')
  expect(await run($, 'trash')).toBe('The trash is empty.')
})

test('a malformed or out-of-range /todos restore changes nothing and sends nothing', async ($, on) => {
  const { clock, submitted } = setup(on, [adding('a', 'b')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1-2')
  for (const args of ['restore', 'restore two', 'restore 2-1']) {
    expect(await run($, args)).toStartWith('Usage:')
  }
  expect(await run($, 'restore 1,3')).toBe('No trash entry 3. Nothing was restored.')
  await clock.advance(0)
  expect(submitted).toEqual([])
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('Trash\n1. b [user]\n   d-b\n2. a [user]\n   d-a')
})

test('/todos purge drops trash entries for good and lifts the user block', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b'), adding('b')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1-2')
  expect(await run($, 'purge 1')).toBe('Purged 1 item:\n1. b')
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('Trash\n1. a [user]\n   d-a')
  await turn($, clock, {})
  expect(await run($, '')).toBe('Todos\n1. b\n   d-b')
})

test('a malformed or out-of-range /todos purge changes nothing and sends nothing', async ($, on) => {
  const { clock, submitted } = setup(on, [adding('a', 'b')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1-2')
  for (const args of ['purge', 'purge two', 'purge 2-1']) {
    expect(await run($, args)).toStartWith('Usage:')
  }
  expect(await run($, 'purge 1,3')).toBe('No trash entry 3. Nothing was purged.')
  await clock.advance(0)
  expect(submitted).toEqual([])
  expect(await run($, 'trash')).toBe('Trash\n1. b [user]\n   d-b\n2. a [user]\n   d-a')
})

test('/todos reset empties the list and the trash and lifts the blocks', async ($, on) => {
  const { clock, submitted } = setup(on, [adding('a', 'b'), adding('a')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1')
  expect(await run($, 'reset now')).toStartWith('Usage:')
  expect(await run($, 'trash')).toBe('Trash\n1. a [user]\n   d-a')
  expect(await run($, 'reset')).toBe('Emptied the list and the trash.')
  expect(await run($, '')).toBe('No open items.')
  expect(await run($, 'trash')).toBe('The trash is empty.')
  await turn($, clock, {})
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
  await clock.advance(0)
  expect(submitted).toEqual([])
})

const GROUP = JSON.stringify({ remove: [3], add: [{ title: 'd', detail: 'd-d' }] })

test('refresh keeps open items, trashes removed ones and appends new ones', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b', 'c')])
  const forked = mockFork(on, [answered(GROUP)])
  await start($)
  await turn($, clock, {})
  expect(await run($, 'refresh')).toBe('Refreshed the list: 3 items.')
  expect(forked[0]).toContain('Current list:\n1. a\n   d-a\n2. b\n   d-b\n3. c\n   d-c')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b\n3. d\n   d-d')
  expect(await run($, 'trash')).toBe('Trash\n1. c [model]\n   d-c')
})

test('a refresh update rewrites only the detail', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b')])
  mockFork(on, [
    answered('{"remove":[],"add":[],"update":[{"number":2,"title":"other","detail":" new\\ndetail "}]}'),
  ])
  await start($)
  await turn($, clock, {})
  await run($, 'refresh')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   new\n   detail')
  expect(await run($, 'trash')).toBe('The trash is empty.')
})

test('an invalid or unparseable refresh reply keeps the list and reports the failure', async ($, on) => {
  const { clock } = setup(on, [adding('a', 'b')])
  const replies: Reply[] = [
    answered('{"remove":[2],"add":[],"update":[{"number":2,"detail":"x"}]}'),
    answered('{"remove":[],"add":[],"update":[{"number":2,"detail":"x"},{"number":2,"detail":"y"}]}'),
    answered('{"remove":[],"add":[],"update":[{"number":2,"detail":"  "}]}'),
    answered('{"remove":[],"add":[],"update":[{"number":3,"detail":"x"}]}'),
    answered('{"remove":[3],"add":[]}'),
    answered('not json'),
    { isAnswered: false, reason: 'api-error' },
  ]
  const { length } = replies
  mockFork(on, replies)
  await start($)
  await turn($, clock, {})
  for (let i = 0; i < length; i += 1) {
    expect(await run($, 'refresh')).toStartWith('Refresh failed')
  }
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b')
  expect(await run($, 'trash')).toBe('The trash is empty.')
})

const NOTHING_TO_FORK: Reply = { isAnswered: false, reason: 'nothing-to-fork' }
const MAIN_MODEL = 'main-model'
const TRANSCRIPT_NOTE = 'rebuilt from the transcript without the prompt cache'

type Message = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; text?: string }[] }
const said = (role: Message['role'], text: string, toolUses: Message['toolUses'] = []): Message => ({
  role,
  text,
  toolUses,
})

// Answers `/todos refresh` with nothing to fork, as right after a resume.
function mockTranscript(on: On, messages: Message[], forks = 1) {
  mockFork(on, Array.from({ length: forks }, () => NOTHING_TO_FORK))
  on('session.messages', () => ({ value: messages as never }))
  on('session.model', () => ({ value: MAIN_MODEL }))
}

test('refresh with nothing to fork rebuilds from the transcript on the session model', async ($, on) => {
  const { asked, models, clock } = setup(on, [adding('a', 'b', 'c'), answered(GROUP)])
  mockTranscript(on, [
    said('user', 'question-text'),
    said('assistant', 'answer-text', [{ tool: 'Bash', text: 'tool-output' }]),
    said('user', ''),
  ])
  await start($)
  await turn($, clock, {})
  expect(await run($, 'refresh')).toBe(`Refreshed the list: 3 items. It was ${TRANSCRIPT_NOTE}.`)
  expect(models.at(-1)).toBe(MAIN_MODEL)
  const prompt = asked.at(-1) ?? ''
  expect(prompt).toContain('[user]\nquestion-text\n\n[assistant]\nanswer-text\n\n[tool Bash]\ntool-output')
  expect(prompt).toContain('against the transcript above')
  expect(prompt).toContain('Current list:\n1. a\n   d-a\n2. b\n   d-b\n3. c\n   d-c')
  expect(prompt.indexOf('question-text')).toBeLessThan(prompt.indexOf('Current list:'))
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b\n3. d\n   d-d')
  expect(await run($, 'trash')).toBe('Trash\n1. c [model]\n   d-c')
})

test('a transcript refresh that fails keeps the list and reports the failure', async ($, on) => {
  const { clock } = setup(on, [adding('a'), answered('not json'), { isAnswered: false, reason: 'timeout' }])
  mockTranscript(on, [said('user', 'hi')], 2)
  await start($)
  await turn($, clock, {})
  expect(await run($, 'refresh')).toBe('Refresh failed (unparseable reply); the list is unchanged.')
  expect(await run($, 'refresh')).toBe('Refresh failed (timeout); the list is unchanged.')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
})

test('a long tool result is clipped in the transcript', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), answered(NOOP)])
  const result = `HEAD${'x'.repeat(TRANSCRIPT_TOOL_RESULT_TEXT * 2)}TAIL`
  mockTranscript(on, [said('assistant', 'done', [{ tool: 'Read', text: result }])])
  await start($)
  await turn($, clock, {})
  await run($, 'refresh')
  const prompt = asked.at(-1) ?? ''
  expect(prompt).toContain('[tool Read]\nHEAD')
  expect(prompt).toContain('[truncated]\n')
  expect(prompt).toContain('TAIL')
  expect(prompt).not.toContain(result)
})

test('a long transcript keeps the newest messages whole', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), answered(NOOP)])
  const size = TRANSCRIPT_TEXT * 0.4
  mockTranscript(on, [
    said('user', `oldest${'x'.repeat(size)}`),
    said('assistant', `older${'x'.repeat(size)}`),
    said('user', `newer${'x'.repeat(size)}`),
    said('assistant', `newest${'x'.repeat(size)}`),
  ])
  await start($)
  await turn($, clock, {})
  await run($, 'refresh')
  const prompt = asked.at(-1) ?? ''
  expect(prompt).not.toContain('oldest')
  expect(prompt).not.toContain('older')
  expect(prompt).toContain('newer')
  expect(prompt).toContain('newest')
  expect(prompt).not.toContain('[truncated]')
})

test('an empty transcript fails without a model request and keeps the list', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a')])
  mockTranscript(on, [said('user', '')])
  await start($)
  await turn($, clock, {})
  expect(await run($, 'refresh')).toBe(
    'Refresh failed: the main conversation has no messages yet, so there is nothing to refresh from. Send a message and try again.',
  )
  expect(asked).toHaveLength(1)
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a')
})

test('a refresh that sends nothing keeps the review count, and one that sends resets it', async ($, on) => {
  const { asked, clock } = setup(on, [adding('a'), ...noops(REVIEW_TURNS), answered(NOOP), ...noops(REVIEW_TURNS)])
  const transcript: Message[] = []
  mockTranscript(on, transcript, 3)
  await start($)
  await turns($, clock, REVIEW_TURNS - 1)
  expect(await run($, 'refresh')).toStartWith('Refresh failed: the main conversation has no messages')
  await turns($, clock, 1, REVIEW_TURNS)
  expect(asked).toHaveLength(REVIEW_TURNS + 1)
  expect(asked.at(-1)).toContain(`Turn 1 of ${REVIEW_TURNS}`)

  await turns($, clock, REVIEW_TURNS - 1, REVIEW_TURNS + 1)
  transcript.push(said('user', 'hi'))
  expect(await run($, 'refresh')).toContain(TRANSCRIPT_NOTE)
  const before = asked.length
  await turns($, clock, 1, 2 * REVIEW_TURNS)
  expect(asked).toHaveLength(before + 1)
})

// Storage

const ALL_AGES = { cleanupPeriodDays: 3650 }
const storedList = (title: string, updatedAt: number) => ({ items: [{ title, detail: '' }], trash: [], updatedAt })
const keyOf = (id: string, value: { updatedAt: number }) => `session:${id}:${value.updatedAt}:${JSON.stringify(value).length}`

// A store in memory that the test can read, count, and make fail. The kit's own
// store cannot reject a set, and a hook cannot be added on top of it.
function fakeStore(failSet: (key: string, setCount: number) => string | null = () => null) {
  const map = new Map<string, unknown>()
  const calls = { get: [] as string[], set: [] as string[] }
  const install = (on: On, entries: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(entries)) {
      map.set(key, value)
    }
    on('store.get', (_$, e) => ({ value: map.get(e.key) as never }))
    on('store.set', (_$, e) => {
      calls.set.push(e.key)
      const message = failSet(e.key, calls.set.length)
      if (message !== null) {
        return { deny: message }
      }
      map.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      map.delete(e.key)
      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...map.keys()] }))
  }
  return { map, calls, install }
}

function setupStored(
  on: On,
  replies: Reply[],
  stored: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
  failSet?: (key: string, setCount: number) => string | null,
) {
  const store = fakeStore(failSet)
  return { ...setup(on, replies, stored, settings, store.install), map: store.map, calls: store.calls }
}

test('a save writes a key with its time and size, replaces it, and deletes it when everything is empty', async ($, on) => {
  const { clock, map } = setupStored(on, [adding('a'), adding('a', 'b')])
  await start($)
  await clock.set(1000)
  await turn($, clock, {})
  const [first, ...rest] = [...map.keys()]
  expect(rest).toEqual([])
  const parsed = parseKey(first ?? '')
  expect(parsed).toMatchObject({ id: 's1', updatedAt: 1000 })
  expect(parsed?.size).toBe(JSON.stringify(map.get(first ?? '')).length)

  await clock.set(2000)
  await turn($, clock, {})
  const second = [...map.keys()]
  expect(second).toHaveLength(1)
  expect(second[0]).toStartWith('session:s1:2000:')
  expect(second[0]).not.toBe(first)

  await run($, 'reset')
  expect([...map.keys()]).toEqual([])
})

test('two saves started together leave one key holding the later list', async ($, on) => {
  const { clock, map } = setupStored(on, [adding('a', 'b', 'c')])
  await start($)
  await turn($, clock, {})
  await run($, 'delete 1-3')
  await Promise.all([run($, 'restore 1'), run($, 'purge 2'), run($, 'purge 3')])
  const keys = [...map.keys()]
  expect(keys).toHaveLength(1)
  const stored = map.get(keys[0] ?? '') as { items: { title: string }[]; trash: unknown[] }
  expect(stored.items.map(one => one.title)).toEqual(['c'])
  expect(stored.trash).toEqual([])
})

test('a session start resumes from the newest of duplicate keys and removes the older ones', async ($, on) => {
  const { map } = setupStored(on, [], { 'session:s1:1000:50': storedList('old', 1000), 'session:s1:2000:60': storedList('new', 2000) }, ALL_AGES)
  await start($)
  expect(await run($, '')).toBe('Todos\n1. new')
  expect([...map.keys()]).toEqual(['session:s1:2000:60'])
})

test('a legacy entry newer than the new keys wins and moves to the new key format', async ($, on) => {
  const newer = storedList('legacy', 3000)
  const { map } = setupStored(on, [], { 'session:s1:2000:60': storedList('new', 2000), 'session:s1': newer }, ALL_AGES)
  await start($)
  expect(await run($, '')).toBe('Todos\n1. legacy')
  expect([...map.keys()]).toEqual([keyOf('s1', newer)])
})

test('a legacy entry older than a new key is removed', async ($, on) => {
  const { map } = setupStored(on, [], { 'session:s1:2000:60': storedList('new', 2000), 'session:s1': storedList('legacy', 1000) }, ALL_AGES)
  await start($)
  expect(await run($, '')).toBe('Todos\n1. new')
  expect([...map.keys()]).toEqual(['session:s1:2000:60'])
})

test('legacy entries of other sessions migrate, and an invalid one is removed', async ($, on) => {
  const other = storedList('other', 1000)
  const { map } = setupStored(on, [], { 'session:a': other, 'session:b': { items: 'bad' } }, ALL_AGES)
  await start($)
  expect([...map.keys()]).toEqual([keyOf('a', other)])
})

test('the sweep expires keys by cleanupPeriodDays without reading their values', async ($, on) => {
  const fresh = storedList('fresh', 39 * DAY_MS)
  const { clock, map, calls } = setupStored(on, [], { 'session:old:0:50': storedList('old', 0), [keyOf('new', fresh)]: fresh }, { cleanupPeriodDays: 30 })
  await clock.set(40 * DAY_MS)
  await start($)
  expect([...map.keys()]).toEqual([keyOf('new', fresh)])
  expect(calls.get).toEqual([])
})

test('the size helper matches the length of the store as JSON text', () => {
  const values: Record<string, unknown> = {}
  const saved = []
  for (const [i, title] of ['a', 'bb', 'ccc'].entries()) {
    const value = storedList(`${title}"\\`, i)
    const key = keyOf(`id${i}`, value)
    values[key] = value
    const parsed = parseKey(key)
    if (parsed !== null) {
      saved.push(parsed)
    }
    expect(storeLength(saved)).toBe(JSON.stringify(values).length)
  }
  expect(storeLength([])).toBe(JSON.stringify({}).length)
})

const SIZE = Math.floor(STORE_CAP * 0.36)

test('over 80% of the cap the sweep drops the oldest sessions first and stops at the target', async ($, on) => {
  const { clock, map } = setupStored(
    on,
    [],
    {
      [`session:old:${10 * DAY_MS}:${SIZE}`]: storedList('old', 0),
      [`session:mid:${40 * DAY_MS}:${SIZE}`]: storedList('mid', 0),
      [`session:new:${90 * DAY_MS}:${SIZE}`]: storedList('new', 0),
    },
    ALL_AGES,
  )
  await clock.set(100 * DAY_MS)
  await start($)
  const kept = [...map.keys()].flatMap(key => parseKey(key)?.id ?? [])
  expect(kept).toEqual(['mid', 'new'])
  expect(3 * SIZE).toBeGreaterThan(STORE_TARGET)
  expect(2 * SIZE).toBeLessThanOrEqual(STORE_TARGET)
})

test('the sweep never drops the current session', async ($, on) => {
  const { clock, map } = setupStored(
    on,
    [],
    {
      [`session:s1:${10 * DAY_MS}:${SIZE}`]: storedList('mine', 0),
      [`session:a:${40 * DAY_MS}:${SIZE}`]: storedList('a', 0),
      [`session:b:${90 * DAY_MS}:${SIZE}`]: storedList('b', 0),
    },
    ALL_AGES,
  )
  await clock.set(100 * DAY_MS)
  await start($)
  expect([...map.keys()].flatMap(key => parseKey(key)?.id ?? [])).toEqual(['s1', 'b'])
  expect(await run($, '')).toBe('Todos\n1. mine')
})

const OVER_CAP = `store is over the ${STORE_CAP} limit`

test('a migration refused for size frees room without dropping the current session', async ($, on) => {
  const { clock, map } = setupStored(
    on,
    [],
    {
      [`session:s1:${10 * DAY_MS}:${SIZE}`]: storedList('mine', 0),
      [`session:a:${40 * DAY_MS}:${SIZE}`]: storedList('a', 0),
      [`session:b:${60 * DAY_MS}:${SIZE}`]: storedList('b', 0),
      'session:old': storedList('legacy', 90 * DAY_MS),
    },
    ALL_AGES,
    (_key, count) => (count === 1 ? OVER_CAP : null),
  )
  await clock.set(100 * DAY_MS)
  await start($)
  expect([...map.keys()].flatMap(key => parseKey(key)?.id ?? [])).toEqual(['s1', 'b', 'old'])
})

test('a save refused for size frees room and is tried once more', async ($, on) => {
  const { clock, map, calls } = setupStored(on, [adding('a')], {}, {}, (_key, count) => (count === 1 ? OVER_CAP : null))
  await start($)
  map.set(`session:other:1:${STORE_CAP}`, {})
  await turn($, clock, {})
  expect(calls.set).toHaveLength(2)
  expect([...map.keys()].flatMap(key => parseKey(key)?.id ?? [])).toEqual(['s1'])
})

test('a save refused for another reason is not retried', async ($, on) => {
  const { clock, toasts, calls, logs } = setupStored(on, [adding('a')], {}, {}, () => 'lock timed out')
  await start($)
  await turn($, clock, {})
  expect(calls.set).toHaveLength(1)
  expect(logs.join('\n')).toContain('lock timed out')
  expect(toasts).toEqual(['List changes are not being saved.'])
})

test('failed saves toast once, keep the band list, and refresh does not call the list unchanged', async ($, on) => {
  const { clock, toasts } = setupStored(on, [adding('a'), adding('a', 'b')], {}, {}, () => 'lock timed out')
  mockFork(on, [answered(GROUP.replace('[3]', '[]'))])
  await start($)
  await turn($, clock, {})
  await turn($, clock, {})
  expect(toasts).toHaveLength(1)
  expect((await shown($)).texts.map(one => one.trim())).toContain('Todos')
  expect(await run($, '')).toBe('Todos\n1. a\n   d-a\n2. b\n   d-b')
  const reply = await run($, 'refresh')
  expect(reply).toBe('Refreshed the list: 3 items.')
  expect(reply).not.toContain('unchanged')
})

test('/clear deletes every key of the session, legacy or new', async ($, on) => {
  const { map } = setupStored(on, [], {
    'session:s1:1000:50': storedList('a', 1000),
    'session:s1:2000:60': storedList('a', 2000),
    'session:s1': storedList('a', 500),
    'session:other:1000:50': storedList('o', 1000),
  }, ALL_AGES)
  on('session.end', (_$, e) => e as never)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  expect([...map.keys()]).toEqual(['session:other:1000:50'])
})

test('a uniform window fits the rows and reserves the more row', () => {
  const count = (length: number, rows: number, cap?: number) => rowWindow(ones(length), 0, -1, rows, cap).count
  expect(count(7, 17)).toBe(7)
  expect(count(7, 5)).toBe(4)
  expect(count(25, 5)).toBe(4)
  expect(count(25, 0)).toBe(1)
  expect(count(25, -2)).toBe(1)
  expect(count(25, 17, 10)).toBe(10)
  expect(count(25, 38)).toBe(25)
  expect(count(25, 10)).toBe(9)
  expect(count(12, 27, 10)).toBe(10)
  expect(count(0, 2)).toBe(0)
})

test('a cap limits the window even when more rows are free', () => {
  expect(rowWindow(ones(25), 0, -1, 40, 4)).toEqual({ start: 0, count: 4 })
  expect(rowWindow(ones(25), 24, -1, 40, 4)).toEqual({ start: 21, count: 4 })
  expect(pageRows(ones(25), 0, 1, 1, 40, 4)).toEqual({ start: 4, index: 5 })
  expect(pageRows(ones(25), 4, 6, -1, 40, 4)).toEqual({ start: 0, index: 2 })
})

test('the wrap counter breaks Latin text at spaces and wide characters anywhere', () => {
  expect(wrapRows('', 10)).toBe(1)
  expect(wrapRows('hello world', 11)).toBe(1)
  expect(wrapRows('hello world', 10)).toBe(2)
  expect(wrapRows('aaaa bbbb cccc', 9)).toBe(2)
  expect(wrapRows('a\nb', 10)).toBe(2)
  expect(wrapRows('abcdefghij', 4)).toBe(3)
  expect(wrapRows('一二三四五', 4)).toBe(3)
  expect(wrapRows('abc 一二三', 6)).toBe(2)
})

test('the window and paging helpers take the window size', () => {
  const list = ones(25)
  expect(rowWindow(list, 0, 5, 5, 4).start).toBe(2)
  expect(rowWindow(list, 20, -1, 5, 4).start).toBe(20)
  expect(rowWindow(list, 24, -1, 5, 4).start).toBe(21)
  expect(pageRows(list, 0, 1, 1, 5, 4)).toEqual({ start: 4, index: 5 })
  expect(pageRows(list, 21, 23, 1, 5, 4)).toBeNull()
  expect(pageRows(list, 4, 6, -1, 5, 4)).toEqual({ start: 0, index: 2 })
})

// Wide enough for the focused help line to fit on one row.
const WIDE_COLUMNS = 200

const bandProps = (maxRows: number, bodyColumns = WIDE_COLUMNS, isWorking = false) =>
  ({ hasSurvey: false, isWorking, maxRows, bodyColumns }) as never

const bandAt = ($: Engine, maxRows: number, bodyColumns = WIDE_COLUMNS) =>
  $.ui.mount({ ...BAND, props: bandProps(maxRows, bodyColumns), requestId: 'band' })

// A session whose list holds `json`'s items, with nothing mounted.
async function listWith($: Engine, on: On, json: string) {
  const ctx = setup(on, [answered(json)])
  await start($)
  await turn($, ctx.clock, {})
  return ctx
}

test('the band fits its window to the rows it is given', async ($, on) => {
  await listWith($, on, listOf(25))
  for (const [rows, numbers, more] of [
    [20, range(1, 10), '15 more'],
    [8, range(1, 4), '21 more'],
    [3, [1], '24 more'],
  ] as const) {
    const band = await bandAt($, rows)
    expect(await windowOf(band)).toEqual({ numbers, more })
    await band.unmount()
  }
})

test('a squeezed short list is windowed and names the paging keys', async ($, on) => {
  await listWith($, on, listOf(7))
  const band = await bandAt($, 8)
  expect(await windowOf(band)).toEqual({ numbers: range(1, 4), more: '3 more' })
  await focusRow($, 0)
  expect(await helpOf(band)).toContain('n/p page')
  expect(await helpOf(band)).toContain('t pane')
  await band.unmount()
})

test('a wrapped focused title takes a row from the window', async ($, on) => {
  const title = '一'.repeat(75)
  const json = JSON.stringify({
    remove: [],
    add: [{ title, detail: '' }, ...range(2, 25).map(n => ({ title: `t${n}`, detail: '' }))],
  })
  await listWith($, on, json)
  const band = await bandAt($, 8, 150)
  expect(wrapRows(`  ${await helpOf(band)}`, 150)).toBe(1)
  await focusRow($, 0)
  expect(wrapRows(`  ${await helpOf(band)}`, 150)).toBe(1)
  expect((await windowOf(band)).numbers).toEqual(range(1, 3))
  await band.unmount()
})

test('a help line that wraps takes a row from the window once the band holds the focus', async ($, on) => {
  await listWith($, on, listOf(25))
  const band = await bandAt($, 8, 80)
  expect((await windowOf(band)).numbers).toEqual(range(1, 4))
  await focusRow($, 0)
  expect((await windowOf(band)).numbers).toEqual(range(1, 3))
  await band.unmount()
})

test('mounting the band again with fewer rows shrinks the window around the focus', async ($, on) => {
  await listWith($, on, listOf(25))
  const tall = await bandAt($, 20)
  await focusRow($, 8)
  expect((await windowOf(tall)).numbers).toEqual(range(1, 10))
  await tall.unmount()
  const short = await bandAt($, 8)
  expect((await windowOf(short)).numbers).toEqual(range(6, 9))
  expect(await dotted(short)).toBe('t9')
  await short.unmount()
})

const PANE_ID = 'todos'

const panePropsOf = (bodyRows: number, isFocused = true, bodyColumns = WIDE_COLUMNS) =>
  ({
    title: 'Todos',
    isFocused,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows },
    view: {},
  }) as never

const paneAt = ($: Engine, bodyRows: number, isFocused = true, bodyColumns = WIDE_COLUMNS) =>
  $.ui.mount({
    plugin: 'todo-list',
    surface: 'terminal',
    component: 'Pane',
    props: panePropsOf(bodyRows, isFocused, bodyColumns),
    requestId: PANE_ID,
  })

const focusPane = ($: Engine, row: number) =>
  $.ui.focus({
    component: 'Pane',
    requestId: PANE_ID,
    plugin: 'todo-list',
    element: `item-${row}`,
    origin: { kind: 'person' },
  })

test('/todos pane opens the pane asking for the keys, again when it is open', async ($, on) => {
  const { opened } = await listWith($, on, THREE)
  expect(await run($, 'pane')).toBe('The Todos pane is open.')
  expect(opened).toEqual([{ id: PANE_ID, title: 'Todos', focus: true }])
  expect(await run($, 'pane')).toBe('The Todos pane is open.')
  expect(opened).toEqual([
    { id: PANE_ID, title: 'Todos', focus: true },
    { id: PANE_ID, title: 'Todos', focus: true },
  ])
})

test('/todos pane hides the band', async ($, on) => {
  await listWith($, on, THREE)
  await expectBandShown($)
  await run($, 'pane')
  await expectBandHidden($)
})

test('a pane that cannot be placed leaves the band shown', async ($, on) => {
  const { placement } = await listWith($, on, THREE)
  placement.isPlaced = false
  expect(await run($, 'pane')).toBe('The Todos pane cannot be shown here.')
  await expectBandShown($)

  const again = await bandAt($, 20)
  await focusRow($, 1)
  await again.press({ key: 'pane' })
  await again.unmount()
  await expectBandShown($)
})

test('/todos pane with text still goes out as a prompt', async ($, on) => {
  const { clock, submitted, opened } = await listWith($, on, THREE)
  expect(await run($, 'pane layout looks wrong')).toBe('Sent the prompt with 3 items.')
  await clock.advance(0)
  expect(submitted).toEqual(['> 1. a\n>    d-a\n>\n> 2. b\n>    d-b\n>\n> 3. c\n>    d-c\n\npane layout looks wrong'])
  expect(opened).toEqual([])
})

test('the band switches to the pane with t, asking for the keys', async ($, on) => {
  const { opened } = await listWith($, on, THREE)
  const band = await bandAt($, 20)
  const keys = await band.findAll({ type: 'Button' })
  expect(keys.find(one => one.props.label === 'pane')?.props.hotkey).toBe('t')
  await focusRow($, 1)
  await band.press({ key: 'pane' })
  expect(opened).toEqual([{ id: PANE_ID, title: 'Todos', focus: true }])
  await band.unmount()
  await expectBandHidden($)
})

test('the pane closes itself with t', async ($, on) => {
  const { closed } = await listWith($, on, THREE)
  await run($, 'pane')
  const pane = await paneAt($, 40)
  const keys = await pane.findAll({ type: 'Button' })
  expect(keys.find(one => one.props.label === 'band')?.props.hotkey).toBe('t')
  await pane.press({ key: 'band' })
  expect(closed).toEqual([{ id: PANE_ID, origin: { kind: 'plugin' } }])
  await pane.unmount()
  await expectBandShown($)
})

test('t on the pane redraws the band that stayed mounted', async ($, on) => {
  await listWith($, on, THREE)
  const band = await bandAt($, 20)
  await run($, 'pane')
  expect(await band.findAll({ type: 'Button' })).toEqual([])
  const pane = await paneAt($, 40)
  await pane.press({ key: 'band' })
  await pane.unmount()
  expect((await band.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
  await band.unmount()
})

test('/clear clears the pane but keeps the pane mode', async ($, on) => {
  on('session.end', (_$, e) => e as never)
  const ctx = setup(on, [answered(listOf(5)), answered(listOf(5))])
  await start($)
  await turn($, ctx.clock, {})
  await run($, 'pane')
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  await turn($, ctx.clock, {})
  await expectBandHidden($)
})

test('a session start and a squeezed band do not open the pane', async ($, on) => {
  const { opened } = await listWith($, on, listOf(25))
  await start($)
  const band = await bandAt($, 3)
  expect((await windowOf(band)).numbers).toEqual([1])
  await band.unmount()
  expect(opened).toEqual([])
})

test('a tall pane shows every item and a short one counts the rest', async ($, on) => {
  await listWith($, on, listOf(25))
  const tall = await paneAt($, 40)
  expect(await windowOf(tall)).toEqual({ numbers: range(1, 25), more: undefined })
  await tall.unmount()
  const short = await paneAt($, 12)
  expect(await windowOf(short)).toEqual({ numbers: range(1, 9), more: '16 more' })
  await short.unmount()
})

test('the pane shows the empty list', async ($, on) => {
  setup(on, [])
  await start($)
  const pane = await paneAt($, 12)
  const texts = (await pane.findAll({ type: 'Text' })).map(one => one.text.trim())
  expect(texts).toContain('No open items.')
  await pane.unmount()
})

test('the pane expands the focused detail in place and the expansion follows the focus', async ($, on) => {
  await listWith($, on, listOf(25))
  const pane = await paneAt($, 40)
  const texts = async () => (await pane.findAll({ type: 'Text' })).map(one => one.text.trim())
  await focusPane($, 3)
  await pane.press({ key: 'details' })
  expect(await texts()).toContain('d-t4')
  expect((await windowOf(pane)).numbers).toEqual(range(1, 25))
  await focusPane($, 4)
  expect(await texts()).toContain('d-t5')
  expect(await texts()).not.toContain('d-t4')
  expect(await dotted(pane)).toBe('t5')
  await pane.press({ key: 'details' })
  expect((await texts()).filter(one => one.startsWith('d-'))).toEqual([])
  await pane.unmount()
})

test('the pane window counts the expanded detail', async ($, on) => {
  await listWith($, on, listOf(25))
  const pane = await paneAt($, 12)
  await focusPane($, 2)
  expect((await windowOf(pane)).numbers).toEqual(range(1, 9))
  await pane.press({ key: 'details' })
  expect((await windowOf(pane)).numbers).toEqual(range(1, 8))
  await pane.unmount()
})

test('the pane keeps its own focus and selection apart from the band', async ($, on) => {
  const { filled } = await listWith($, on, listOf(25))
  const band = await bandAt($, 20)
  const pane = await paneAt($, 40)
  await focusRow($, 1)
  await focusPane($, 5)
  await pane.press({ key: 'select' })
  expect(await marks(band)).toBe(0)
  expect(await marks(pane)).toBe(1)
  expect(await dotted(band)).toBe('t2')
  expect(await dotted(pane)).toBe('t6')

  // The band's Esc and a prompt edit leave the pane as it was.
  await pane.press({ key: 'details' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } })
  const prompt = $.prompt as typeof $.prompt & { edit: EngineCall<'prompt.edit'> }
  await prompt.edit({ text: 'x', inputText: 'x', cursor: 1, start: 1, end: 1 } as never)
  expect(await dotted(band)).toBeUndefined()
  expect(await dotted(pane)).toBe('t6')
  expect(await marks(pane)).toBe(1)
  expect((await pane.findAll({ type: 'Text' })).map(one => one.text.trim())).toContain('d-t6')

  await pane.press({ key: 'paste' })
  expect(filled).toEqual(['> 6. t6\n>    d-t6\n\n'])
  expect(await marks(pane)).toBe(0)
  await band.unmount()
  await pane.unmount()
})

test('clearing the session clears the pane atoms', async ($, on) => {
  on('session.end', (_$, e) => e as never)
  const ctx = setup(on, [answered(listOf(5)), answered(listOf(5))])
  await start($)
  await turn($, ctx.clock, {})
  const pane = await paneAt($, 40)
  await focusPane($, 3)
  await pane.press({ key: 'select' })
  await pane.press({ key: 'details' })
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  await turn($, ctx.clock, {})
  expect(await dotted(pane)).toBeUndefined()
  expect(await marks(pane)).toBe(0)
  const texts = (await pane.findAll({ type: 'Text' })).map(one => one.text.trim())
  expect(texts.filter(one => one.startsWith('d-'))).toEqual([])
  await pane.unmount()
})

test('a band delete under the pane focus hands the focus to the item now there', async ($, on) => {
  await listWith($, on, listOf(5))
  const pane = await paneAt($, 40)
  await focusPane($, 2)
  expect(await dotted(pane)).toBe('t3')
  await run($, 'delete 3')
  expect(await dotted(pane)).toBe('t4')
  await run($, 'delete 3-4')
  expect(await dotted(pane)).toBe('t2')
  await pane.unmount()
})

test('a confirmed pane delete moves the pane focus to the item that followed', async ($, on) => {
  const { clock } = await listWith($, on, listOf(5))
  const pane = await paneAt($, 40)
  await focusPane($, 2)
  await pane.press({ key: 'delete' })
  expect((await pane.findAll({ type: 'Text' })).map(one => one.text.trim())).toContain('delete?')
  await pane.press({ key: 'delete' })
  await clock.advance(0)
  expect(await dotted(pane)).toBe('t4')
  expect((await windowOf(pane)).numbers).toEqual(range(1, 4))
  await pane.unmount()
})

test('the pane draws no focus dot and hides an armed delete while it lacks the keys', async ($, on) => {
  await listWith($, on, listOf(5))
  const held = await paneAt($, 40)
  await focusPane($, 3)
  await held.press({ key: 'delete' })
  const dot = async (pane: Drawn) => (await pane.findAll({ type: 'Text', text: '• ' }))[0]
  expect(await dot(held)).toBeDefined()
  await held.unmount()

  const away = await paneAt($, 40, false)
  expect(await dot(away)).toBeUndefined()
  expect((await away.findAll({ type: 'Text' })).map(one => one.text.trim())).not.toContain('delete?')
  await away.unmount()
})

test('the ring entering the pane lands on the item it left and cancels an armed delete', async ($, on) => {
  const { landed } = await listWith($, on, listOf(5))
  const held = await paneAt($, 40)
  await focusPane($, 3)
  await held.press({ key: 'delete' })
  await held.unmount()

  const away = await paneAt($, 40, false)
  await focusPane($, 0)
  expect(landed.at(-1)).toBe('item-3')
  await away.unmount()
  const back = await paneAt($, 40)
  expect(await dotted(back)).toBe('t4')
  expect((await back.findAll({ type: 'Text' })).map(one => one.text.trim())).not.toContain('delete?')
  await back.unmount()
})

test('a pane with no focus yet puts the ring on its first shown item', async ($, on) => {
  await listWith($, on, listOf(5))
  const pane = await paneAt($, 40)
  const autoFocused = async () =>
    (await pane.findAll({ type: 'Button' })).filter(one => one.props.autoFocus === true).map(one => one.key)
  expect(await autoFocused()).toEqual(['item-0'])

  await focusPane($, 3)
  expect(await autoFocused()).toEqual(['item-3'])
  await pane.unmount()
})

test('the pane asks /btw and waits for the turn the band reports', async ($, on) => {
  const { clock, ran, toasts } = await listWith($, on, listOf(3))
  const pane = await paneAt($, 40)
  await focusPane($, 1)
  await pane.press({ key: 'ask' })
  await clock.advance(0)
  expect(ran).toHaveLength(1)
  expect(ran[0]?.args).toContain('"t2"')
  expect(toasts).toEqual([])

  const busy = await $.ui.mount({ ...BAND, props: bandProps(20, 80, true), requestId: 'band' })
  await pane.press({ key: 'ask' })
  await clock.advance(0)
  expect(toasts).toHaveLength(1)
  await busy.unmount()
  await pane.unmount()
})

test('the pane help line names its keys while focused and the focus chord while not', async ($, on) => {
  await listWith($, on, listOf(25))
  const pane = await paneAt($, 12)
  await focusPane($, 0)
  const help = await helpOf(pane)
  expect(help).toContain('o/Enter expand')
  expect(help).toContain('n/p page')
  expect(help).toContain('t band')
  expect(help).not.toContain('t pane')
  await pane.press({ key: 'details' })
  expect(await helpOf(pane)).toContain('o/Enter collapse')
  await pane.unmount()

  const away = await paneAt($, 12, false)
  expect(await helpOf(away)).toBe('Ctrl+X Tab to focus')
  await away.unmount()
})

test('the pane help line leaves the paging keys out when the list fits', async ($, on) => {
  await listWith($, on, listOf(5))
  const pane = await paneAt($, 40)
  await focusPane($, 0)
  expect(await helpOf(pane)).toContain('v paste')
  expect(await helpOf(pane)).not.toContain('n/p page')
  await pane.unmount()
})

const defaultViewRow = (value: string) => ({
  key: 'todo-list.default_view',
  label: 'Default view',
  kind: 'choice',
  value,
  options: ['band', 'pane'],
  provider: { kind: 'plugin', name: 'todo-list' },
  isLocked: false,
})

// A session that starts with `default_view` set to `value`, then holds `json`'s items.
async function startedWith($: Engine, on: On, value: string, json = listOf(3)) {
  const ctx = setup(on, [answered(json)])
  on('config.list', () => ({ value: [defaultViewRow(value)] }) as never)
  on('session.end', (_$, e) => e as never)
  await start($)
  await turn($, ctx.clock, {})
  return ctx
}

test('a default view of pane opens the pane at session start, also on an empty list', async ($, on) => {
  const ctx = setup(on, [])
  on('config.list', () => ({ value: [defaultViewRow('pane')] }) as never)
  await start($)
  expect(ctx.opened).toEqual([{ id: PANE_ID, title: 'Todos' }])
  await expectBandHidden($)
  const pane = await paneAt($, 12)
  expect((await pane.findAll({ type: 'Text' })).map(one => one.text.trim())).toContain('No open items.')
  await pane.unmount()
})

test('a default view of band leaves the pane closed', async ($, on) => {
  const { opened } = await startedWith($, on, 'band')
  expect(opened).toEqual([])
  await expectBandShown($)
})

test('a missing or unreadable default view row leaves the band', async ($, on) => {
  const ctx = setup(on, [])
  on('config.list', () => ({ value: [] }) as never)
  await start($)
  expect(ctx.opened).toEqual([])
})

test('a default view that cannot be read leaves the band', async ($, on) => {
  const ctx = setup(on, [])
  on('config.list', () => {
    throw new Error('unreadable')
  })
  await start($)
  expect(ctx.opened).toEqual([])
})

test('a pane that cannot be placed at session start leaves the band', async ($, on) => {
  const ctx = setup(on, [answered(listOf(3))])
  ctx.placement.isPlaced = false
  on('config.list', () => ({ value: [defaultViewRow('pane')] }) as never)
  await start($)
  await turn($, ctx.clock, {})
  expect(ctx.opened).toHaveLength(1)
  await expectBandShown($)
})

test('a reload does not apply the default view again', async ($, on) => {
  const { opened } = await startedWith($, on, 'pane')
  expect(opened).toHaveLength(1)
  await start($)
  expect(opened).toHaveLength(1)
})

test('/clear does not apply the default view again', async ($, on) => {
  const ctx = await startedWith($, on, 'pane')
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  expect(ctx.opened).toHaveLength(1)
})

test('row windows hold the whole list when it fits', () => {
  expect(rowWindow([2, 1, 2], 0, -1, 5)).toEqual({ start: 0, count: 3 })
  expect(rowWindow([2, 1, 2], 2, 2, 5)).toEqual({ start: 0, count: 3 })
  expect(rowWindow([], 3, -1, 5)).toEqual({ start: 0, count: 0 })
})

test('a row window reserves the more row and holds at least one item', () => {
  // 2 + 2 + 1 rows, then the more row.
  expect(rowWindow([2, 2, 1, 2, 2, 2], 0, -1, 6)).toEqual({ start: 0, count: 3 })
  expect(rowWindow([2, 2, 1, 2, 2, 2], 0, -1, 7)).toEqual({ start: 0, count: 3 })
  expect(rowWindow([2, 2, 1, 2, 2, 2], 0, -1, 8)).toEqual({ start: 0, count: 4 })
  expect(rowWindow([5, 5], 0, -1, 2)).toEqual({ start: 0, count: 1 })
  expect(rowWindow([5, 5], 1, -1, 2)).toEqual({ start: 1, count: 1 })
})

test('a row window moves the least distance that shows the whole focused item', () => {
  const heights = [2, 2, 2, 2, 2, 2, 2, 2]
  expect(rowWindow(heights, 0, 2, 7)).toEqual({ start: 0, count: 3 })
  expect(rowWindow(heights, 0, 3, 7)).toEqual({ start: 1, count: 3 })
  expect(rowWindow(heights, 4, 1, 7)).toEqual({ start: 1, count: 3 })
  // A tall focused item pushes the start on past items that would still fit.
  expect(rowWindow([1, 1, 1, 6, 1], 0, 3, 8)).toEqual({ start: 2, count: 3 })
  expect(rowWindow([1, 1, 1, 6, 1], 0, 3, 7)).toEqual({ start: 3, count: 2 })
})

test('a row window that reaches the last item pulls up while earlier items fit', () => {
  const heights = [2, 2, 1, 2, 2, 2]
  expect(rowWindow(heights, 5, -1, 7)).toEqual({ start: 2, count: 4 })
  expect(rowWindow(heights, 4, 5, 7)).toEqual({ start: 2, count: 4 })
  expect(rowWindow(heights, 99, -1, 7)).toEqual({ start: 2, count: 4 })
})

test('a page down starts at the first item after the window and keeps the focus offset', () => {
  const heights = Array.from({ length: 25 }, () => 1)
  expect(pageRows(heights, 0, 2, 1, 10)).toEqual({ start: 9, index: 11 })
  // The last window is held full: 10 items fit, as no more row follows.
  expect(pageRows(heights, 9, 11, 1, 10)).toEqual({ start: 15, index: 17 })
  expect(pageRows(heights, 15, 17, 1, 10)).toBeNull()
  expect(pageRows(heights, 15, 17, -1, 10)).toEqual({ start: 6, index: 8 })
})

test('a page down clamps the focus offset to the new window', () => {
  const heights = [1, 1, 1, 1, 1, 1, 1, 3, 3]
  // Window 0-3, then 4-6 where the focus offset 3 clamps to the third item.
  expect(pageRows(heights, 0, 3, 1, 5)).toEqual({ start: 4, index: 6 })
  expect(pageRows([1, 1, 1, 1, 1, 3, 3], 0, 3, 1, 5)).toEqual({ start: 4, index: 4 + 1 })
})

test('a page up ends just before the current start', () => {
  const heights = [2, 2, 1, 2, 2, 2, 2, 2]
  // The window from 5 shows 5-7; a page up ends before it and fills rows back to item 2.
  expect(pageRows(heights, 5, 6, -1, 7)).toEqual({ start: 2, index: 3 })
  expect(pageRows(heights, 2, 3, -1, 7)).toEqual({ start: 0, index: 1 })
  // A window of 1 item reaches back one item at a time when none else fits.
  expect(pageRows([5, 5, 5], 2, 2, -1, 3)).toEqual({ start: 1, index: 1 })
})

test('paging does nothing when the window cannot move', () => {
  expect(pageRows([1, 1, 1], 0, 1, 1, 10)).toBeNull()
  expect(pageRows([1, 1, 1], 0, 1, -1, 10)).toBeNull()
  expect(pageRows(Array.from({ length: 25 }, () => 1), 0, 2, -1, 10)).toBeNull()
  expect(pageRows(Array.from({ length: 25 }, () => 1), 15, 16, 1, 10)).toBeNull()
  expect(pageRows([], 0, -1, 1, 10)).toBeNull()
})

// At this width every title takes two rows, apart from item 3.
const NARROW = 70
const WRAPPED_ROWS = 25
const wrappedTitle = (n: number) => (n === 3 ? 'short' : `t${n} ${`${'w'.repeat(9)} `.repeat(7)}`.trim())
const WRAPPED = JSON.stringify({
  remove: [],
  add: range(1, WRAPPED_ROWS).map(n => ({ title: wrappedTitle(n), detail: `d-${n}` })),
})

test('the pane draws every title whole and fits its window to the rows they take', async ($, on) => {
  await listWith($, on, WRAPPED)
  // 12 body rows less the heading and the help line leave 10 for items and the more row.
  const pane = await paneAt($, 12, false, NARROW)
  const texts = (await pane.findAll({ type: 'Text' })).map(one => one.text.trim())
  expect(await windowOf(pane)).toEqual({ numbers: range(1, 5), more: '20 more' })
  expect(texts).toContain(wrappedTitle(2))
  expect(texts).toContain(wrappedTitle(5))
  await pane.unmount()
  const band = await bandAt($, 20, NARROW)
  expect((await band.findAll({ type: 'Text' })).map(one => one.text.trim())).not.toContain(wrappedTitle(2))
  await band.unmount()
})

test('the pane counts the expanded detail in rows and moves the window to show it', async ($, on) => {
  await listWith($, on, WRAPPED)
  // 15 body rows less the heading and the two help rows leave 12 for items and the more row.
  const pane = await paneAt($, 15, true, NARROW)
  expect(wrapRows(`  ${await helpOf(pane)}`, NARROW)).toBe(2)
  expect((await windowOf(pane)).numbers).toEqual(range(1, 6))
  await focusPane($, 0)
  await pane.press({ key: 'details' })
  expect((await windowOf(pane)).numbers).toEqual(range(1, 5))
  await focusPane($, 5)
  expect((await windowOf(pane)).numbers).toEqual(range(2, 6))
  await pane.unmount()
})

test('the pane help line names the paging keys while the rows cannot hold the list', async ($, on) => {
  await listWith($, on, WRAPPED)
  const short = await paneAt($, 12)
  await focusPane($, 0)
  expect(await helpOf(short)).toContain('n/p page')
  await short.unmount()
  const tall = await paneAt($, 80)
  expect(await helpOf(tall)).not.toContain('n/p page')
  expect((await windowOf(tall)).numbers).toEqual(range(1, WRAPPED_ROWS))
  await tall.unmount()
})
