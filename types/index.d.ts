export type TodoItem = { title: string; detail: string }

// One finished turn waiting to update the list.
export type PendingTurn = ReviewTurn & { previousAnswer: string }

// An item that left the list, and who removed it.
export type TrashEntry = TodoItem & { by: 'user' | 'model'; at: number }

// One counted turn waiting for the next review.
export type ReviewTurn = { userText: string; answer: string }

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
      deleting: string
      selected: string[]
      lastAnswer: string
      pending: PendingTurn[]
    }
  }
}
