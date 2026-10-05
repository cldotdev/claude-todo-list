import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
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
  const clock = mock.clock(on)
  mock.store(on, stored)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('command.run', () => ({ text: '' }))
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
  return { asked, clock, filled, landed, submitted }
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
  expect(buttons).toBe(5)
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
  expect(buttons).toBe(4)
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

test('the quote key quotes the focused item into the prompt', async ($, on) => {
  const { clock, filled } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":"d-b"}]}' }])
  await start($)
  await turn($, clock, {})

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await focusRow($, 1)
  await ui.press({ key: 'quote' })
  await ui.unmount()
  expect(filled).toEqual(['> b\n> d-b\n\n'])
  expect((await shown($)).buttons).toBe(5)
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
  await focusOn($, 'quote-all')
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
  expect((await shown($)).buttons).toBe(4)

  await turn($, clock, {})
  expect(asked[1]).toContain('Items the user already ticked off')
  expect(asked[1]).toContain('["a"]')
  expect((await shown($)).buttons).toBe(4)
})

test('the band shows every item', async ($, on) => {
  const { clock } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"1","detail":"d-1"},{"title":"2","detail":"d-2"},{"title":"3","detail":"d-3"},{"title":"4","detail":"d-4"},{"title":"5","detail":"d-5"},{"title":"6","detail":"d-6"},{"title":"7","detail":"d-7"}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const { texts, buttons } = await shown($)
  expect(buttons).toBe(10)
  expect(texts.map(one => one.trim())).toContain('Todos')
})

test('/todos lists and clears', async ($, on) => {
  const { clock } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"}]}' }])
  await start($)
  await turn($, clock, {})
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toContain('1. a\n    d-a')
  await $.command.run({ command: 'todos', args: 'clear', origin, presentation })
  const empty = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(empty.text).toBe('No open items.')
})

test('a detail-less item quotes only its title', async ($, on) => {
  const { clock, filled } = setup(on, [{ isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":""}]}' }])
  await start($)
  await turn($, clock, {})
  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await focusRow($, 0)
  await ui.press({ key: 'quote' })
  await ui.unmount()
  expect(filled).toEqual(['> a\n\n'])
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
  expect(listed.text).toBe('Todos\n1. a\n    x')
})

test('stored string items migrate to items without a detail', async ($, on) => {
  setup(on, [], {
    'session:s1': { items: ['old', { title: 'new', detail: 'x' }], done: [], updatedAt: Date.now() },
  })
  await start($)
  const listed = await $.command.run({ command: 'todos', args: '', origin, presentation })
  expect(listed.text).toBe('Todos\n1. old\n2. new\n    x')
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

test('the details key switches the band to the focused item and its detail, and back', async ($, on) => {
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

  const again = await $.ui.mount({ ...BAND, requestId: 'band' })
  await again.press({ key: 'details' })
  await again.unmount()
  expect((await shown($)).texts).not.toContain('d-a')
})

test('the quote-all key quotes every item numbered', async ($, on) => {
  const { clock, filled } = setup(on, [
    { isAnswered: true, text: '{"remove":[],"add":[{"title":"a","detail":"d-a"},{"title":"b","detail":""}]}' },
  ])
  await start($)
  await turn($, clock, {})
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'quote-all' })
  await ui.unmount()
  expect(filled).toEqual(['> 1. a\n>    d-a\n\n\n\n> 2. b\n\n'])
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
  expect(submitted).toEqual(['> 1. a\n>    d-a\n> 2. b\n\n先做哪一項？'])
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
  expect(listed.text).toBe(`Todos\n1. a\n    ${'x'.repeat(MAX_DETAIL_LENGTH)}`)
})
