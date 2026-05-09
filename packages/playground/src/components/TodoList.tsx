import { useTabMesh, useTabMeshEvent } from '@tabmesh/react';
import { type FormEvent, useCallback, useState } from 'react';
import { mesh } from '../mesh';
import { useTodoStore } from '../store';
import type { TodoAddPayload, TodoCompletePayload, TodoDeletePayload } from '../types';
import { TodoItem } from './TodoItem';

export function TodoList() {
  const { status } = useTabMesh();
  const [todos, dispatch] = useTodoStore();
  const [text, setText] = useState('');
  const [urgent, setUrgent] = useState(false);

  // Listen for todo events from all tabs
  useTabMeshEvent<TodoAddPayload>('todo.add', (event) => {
    dispatch({ type: 'add', payload: event.payload });
  });

  useTabMeshEvent<TodoCompletePayload>('todo.complete', (event) => {
    dispatch({ type: 'complete', payload: event.payload });

    // Send TTL notification when a remote tab completes a todo (Feature 7)
    if (event.source === 'remote') {
      const todo = todos.find((t) => t.id === event.payload.id);
      if (todo) {
        mesh.send({
          type: 'notification',
          payload: {
            message: `${event.payload.completedBy.slice(0, 8)} completed "${todo.text}"`,
            from: event.payload.completedBy,
          },
          ttl: 5000,
        });
      }
    }
  });

  useTabMeshEvent<TodoDeletePayload>('todo.delete', (event) => {
    dispatch({ type: 'delete', payload: event.payload });
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;

      const payload: TodoAddPayload = {
        id: `${status.tabId}-${Date.now()}`,
        text: trimmed,
        createdBy: status.tabId,
        urgent,
        createdAt: Date.now(),
      };

      mesh.send({
        type: 'todo.add',
        payload,
        priority: urgent ? 10 : 0,
      });

      setText('');
      setUrgent(false);
    },
    [text, urgent, status.tabId]
  );

  return (
    <section className="panel">
      <h2>Todos ({todos.length})</h2>
      <form className="todo-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What needs to be done?"
          className="todo-input"
        />
        <label className="urgent-label">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          Urgent
        </label>
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>
      <ul className="todo-list">
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onComplete={(id) => {
              mesh.send({
                type: 'todo.complete',
                payload: { id, completedBy: status.tabId },
              });
            }}
            onDelete={(id) => {
              mesh.send({
                type: 'todo.delete',
                payload: { id, deletedBy: status.tabId },
              });
            }}
          />
        ))}
        {todos.length === 0 && <li className="todo-empty">No todos yet. Add one above.</li>}
      </ul>
    </section>
  );
}
