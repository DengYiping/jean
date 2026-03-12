import { describe, expect, it } from 'vitest'
import type { ToolCall } from './chat'
import { codexTodoListToTodos, getTodosFromToolCall } from './chat'

describe('chat todo adapters', () => {
  it('normalizes Codex todo list items into widget todos', () => {
    expect(
      codexTodoListToTodos({
        items: [
          {
            text: 'Inspect event bridge',
            status: 'completed',
            completed: true,
          },
          {
            text: 'Patch frontend adapter',
            status: 'in_progress',
            activeForm: 'Patching frontend adapter',
            completed: false,
          },
          {
            text: 'Run tests',
            completed: false,
          },
        ],
      })
    ).toEqual([
      {
        content: 'Inspect event bridge',
        activeForm: 'Inspect event bridge',
        status: 'completed',
      },
      {
        content: 'Patch frontend adapter',
        activeForm: 'Patching frontend adapter',
        status: 'in_progress',
      },
      {
        content: 'Run tests',
        activeForm: 'Run tests',
        status: 'pending',
      },
    ])
  })

  it('extracts todos from both TodoWrite and CodexTodoList tool calls', () => {
    const todoWrite: ToolCall = {
      id: 'todo-write-1',
      name: 'TodoWrite',
      input: {
        todos: [
          {
            content: 'Implement change',
            activeForm: 'Implementing change',
            status: 'in_progress',
          },
        ],
      },
    }

    const codexTodoList: ToolCall = {
      id: 'codex-todo-1',
      name: 'CodexTodoList',
      input: {
        items: [{ text: 'Review result', completed: true }],
      },
    }

    expect(getTodosFromToolCall(todoWrite)).toEqual(
      (todoWrite.input as { todos: unknown[] }).todos
    )
    expect(getTodosFromToolCall(codexTodoList)).toEqual([
      {
        content: 'Review result',
        activeForm: 'Review result',
        status: 'completed',
      },
    ])
  })
})
