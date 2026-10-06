export type TodoItem = { title: string; detail: string }

// One finished turn waiting to update the list.
export type PendingTurn = { previousAnswer: string; userText: string; answer: string }

export type TodoListState = {
  items: TodoItem[]
  done: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'todo-list': {
      items: TodoItem[]
      done: string[]
      focused: string
      detailed: string
      deleting: string
      selected: string[]
      lastAnswer: string
      pending: PendingTurn[]
    }
  }
}
