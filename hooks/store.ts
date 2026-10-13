// Claude Code rejects a store whose JSON text passes this many characters.
export const STORE_CAP = 4_194_304
// The sweep and the retry free room down to this length, so a save rarely meets the cap.
export const STORE_TARGET = Math.floor(STORE_CAP * 0.8)
export const STORE_PREFIX = 'session:'

// An entry's key carries its age and size, so they are known without reading values.
export type SavedKey = { key: string; id: string; updatedAt: number; size: number }

export const savedKeyFor = (id: string, updatedAt: number, size: number) =>
  `${STORE_PREFIX}${id}:${updatedAt}:${size}`

// The last two segments are the numbers, so an id is never split.
export function parseKey(key: string): SavedKey | null {
  const match = /^session:(.+):(\d+):(\d+)$/.exec(key)
  return match === null ? null : { key, id: match[1] ?? '', updatedAt: Number(match[2]), size: Number(match[3]) }
}

// Any other session key is a legacy `session:<id>` one, which holds no metadata.
export const legacyId = (key: string) => (key.startsWith(STORE_PREFIX) && parseKey(key) === null ? key.slice(STORE_PREFIX.length) : null)

// The length of the whole store as JSON text, the measure the cap applies to:
// braces, then `"key":value` pairs joined by commas.
export const storeLength = (saved: readonly SavedKey[]) =>
  saved.length === 0 ? 2 : 2 + saved.reduce((sum, one) => sum + JSON.stringify(one.key).length + 1 + one.size, saved.length - 1)

// The keys of whole sessions to delete, oldest update first and never the
// current session, to bring the store down to STORE_TARGET.
export function keysToDrop(saved: readonly SavedKey[], currentId: string): string[] {
  const sessions = new Map<string, { updatedAt: number; keys: SavedKey[] }>()
  for (const one of saved) {
    const session = sessions.get(one.id) ?? { updatedAt: 0, keys: [] }
    session.updatedAt = Math.max(session.updatedAt, one.updatedAt)
    session.keys.push(one)
    sessions.set(one.id, session)
  }
  const oldest = [...sessions.entries()].filter(([id]) => id !== currentId).sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
  const dropped: string[] = []
  let remaining = saved
  for (const [, session] of oldest) {
    if (storeLength(remaining) <= STORE_TARGET) {
      break
    }
    const gone = new Set(session.keys)
    remaining = remaining.filter(one => !gone.has(one))
    dropped.push(...session.keys.map(one => one.key))
  }
  return dropped
}
