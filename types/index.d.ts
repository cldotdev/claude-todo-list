export type TodoItem = { title: string; detail: string }

// One finished turn waiting to update the list.
export type PendingTurn = ReviewTurn & { previousAnswer: string }

// An item that left the list, and who removed it.
export type TrashEntry = TodoItem & { by: 'user' | 'model'; at: number }

// One counted turn waiting for the next review.
export type ReviewTurn = { userText: string; answer: string }

// Which view shows the list.
export type ViewKind = 'band' | 'pane'

export type TodoListState = {
  items: TodoItem[]
  trash: TrashEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    'todo-list': {
      items: TodoItem[]
      trash: TrashEntry[]
      review: ReviewTurn[]
      focused: string
      detailed: string
      windowStart: number
      deleting: string
      selected: string[]
      paneFocused: string
      paneFocusIndex: number
      paneDetailed: string
      paneDeleting: string
      paneSelected: string[]
      paneWindowStart: number
      mode: ViewKind
      viewApplied: boolean
      lastAnswer: string
      pending: PendingTurn[]
      savedKey: string
      failureShown: boolean
    }
  }
}
