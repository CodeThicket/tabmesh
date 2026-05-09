import { useReducer } from 'react';
import type { TodoAddPayload, TodoCompletePayload, TodoDeletePayload, TodoItem } from './types';

type TodoAction =
  | { type: 'add'; payload: TodoAddPayload }
  | { type: 'complete'; payload: TodoCompletePayload }
  | { type: 'delete'; payload: TodoDeletePayload };

function todoReducer(state: TodoItem[], action: TodoAction): TodoItem[] {
  switch (action.type) {
    case 'add': {
      if (state.some((t) => t.id === action.payload.id)) return state;
      return [
        ...state,
        {
          id: action.payload.id,
          text: action.payload.text,
          completed: false,
          createdBy: action.payload.createdBy,
          urgent: action.payload.urgent,
          createdAt: action.payload.createdAt,
        },
      ];
    }
    case 'complete':
      return state.map((t) =>
        t.id === action.payload.id
          ? { ...t, completed: true, completedBy: action.payload.completedBy }
          : t
      );
    case 'delete':
      return state.filter((t) => t.id !== action.payload.id);
    default:
      return state;
  }
}

export function useTodoStore() {
  return useReducer(todoReducer, []);
}
