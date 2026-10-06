import { expect, mock, test } from 'claude-code/testing'
import type { Engine, EngineCall, MockClock, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MAX_DETAIL_LENGTH } from '../hooks/list'

const USAGE = { input_tokens: 1, output_tokens: 1 } as never
const BAND = {
  plugin: 'todo-list',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80 } as never,
} as const

type Reply = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

function setup(
  on: On,
  replies: Reply[],
  stored: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
) {
  const asked: string[] = []
  const filled: string[] = []
  const submitted: string[] = []
  const landed: (string | undefined)[] = []
  const ran: { command: string; args: string }[] = []
  const toasts: string[] = []
  const clock = mock.clock(on)
  mock.store(on, stored)
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
    return {} as never
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
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    const reply = replies.shift() ?? { isAnswered: false, reason: 'empty-reply' }
    return { value: { usage: USAGE, ...reply } as never }
  })
  return { asked, clock, filled, landed, ran, submitted, toasts }
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

async function shown($: Engine) {
  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const buttons = (await ui.findAll({ type: 'Button' })).length
  await ui.unmount()
  return { texts, buttons }
}

test('a normal answer updates the list and draws the band', async ($, on) => {
  const { asked, clock } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"補跑測試","detail":"d-補跑測試"},{"title":"確認設計","detail":"d-確認設計"}]}' }])
  await start($)
  await turn($, clock, {})
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('ask')
  const { texts, buttons } = await shown($)
  expect(texts.map(one => one.trim())).toContain('Todos')
  expect(buttons).toBe(10)
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
  expect(buttons).toBe(9)
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
  expect((await shown($)).buttons).toBe(10)
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
  expect((await shown($)).buttons).toBe(9)

  await turn($, clock, {})
  expect(asked[1]).toContain('Items the user removed')
  expect(asked[1]).toContain('["a"]')
  expect((await shown($)).buttons).toBe(9)
})

test('the band shows every item', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"1","detail":"d-1"},{"title":"2","detail":"d-2"},{"title":"3","detail":"d-3"},{"title":"4","detail":"d-4"},{"title":"5","detail":"d-5"},{"title":"6","detail":"d-6"},{"title":"7","detail":"d-7"}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const { texts, buttons } = await shown($)
  expect(buttons).toBe(15)
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
    'session:s1': { items: ['old', { title: 'new', detail: 'x' }], done: [], updatedAt: Date.now() },
  })
  await start($)
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. old\n2. new\n   x')
})

const DAY_MS = 24 * 60 * 60 * 1000

// Resumes a session whose list was last saved 40 days ago, and lists it.
async function listAfter40Days($: Engine, on: On, settings: Record<string, unknown>) {
  const saved = { items: [{ title: 'a', detail: '' }], done: [], updatedAt: 0 }
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

// The title text of the row the dot marks.
async function dotted(band: Mounted<'terminal', 'AbovePrompt'>) {
  const texts = (await band.findAll({ type: 'Text' })).map(one => one.text)
  const at = texts.indexOf('• ')
  return at === -1 ? undefined : texts[at + 3]
}

test('the delete key arms on the first press and deletes on the second, recording the title', async ($, on) => {
  const { asked, clock, band, listed } = await bandWith($, on, THREE, [{ isAnswered: true, text: THREE }])
  await focusRow($, 1)
  await band.press({ key: 'delete' })
  expect(await listed()).toEqual(['1. a', '   d-a', '2. b', '   d-b', '3. c', '   d-c'])
  expect((await shown($)).texts.join('|')).toContain('delete?')
  expect((await shown($)).texts.join('|')).toContain('d to confirm delete · Esc to cancel')
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
  expect(await help()).toBe('Ctrl+x Tab to focus')
  await focusRow($, 0)
  expect(await help()).not.toContain('Ctrl+x Tab')
  expect(await help()).toContain('Esc to leave')
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
  expect(texts).toContain('Ctrl+x Tab to focus')
})

const FIVE = JSON.stringify({
  remove: [],
  add: ['a', 'b', 'c', 'd', 'e'].map(title => ({ title, detail: `d-${title}` })),
})

const marks = async (band: Mounted<'terminal', 'AbovePrompt'>) =>
  (await band.findAll({ type: 'Text' })).filter(one => one.text === '✓ ').length

const helpOf = async (band: Mounted<'terminal', 'AbovePrompt'>) =>
  (await band.findAll({ type: 'Text' })).map(one => one.text).at(-1)?.trim()

test('the select key toggles the focused item and marks it', async ($, on) => {
  const { band } = await bandWith($, on, THREE)
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(0)
  await focusRow($, 1)
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(1)
  expect(await helpOf(band)).toContain('p to paste 1')
  await band.press({ key: 'select' })
  expect(await marks(band)).toBe(0)
  expect(await helpOf(band)).toContain('p to paste ·')
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
  expect(await helpOf(band)).toContain('p to paste 2')
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
  expect(await helpOf(band)).toContain('p to paste 2')
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
