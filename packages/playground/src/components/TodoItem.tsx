import type { TodoItem as TodoItemType } from '../types';

interface TodoItemProps {
  todo: TodoItemType;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TodoItem({ todo, onComplete, onDelete }: TodoItemProps) {
  const creatorShort = todo.createdBy.slice(0, 8);
  const completerShort = todo.completedBy?.slice(0, 8);

  return (
    <li className={`todo-item ${todo.completed ? 'completed' : ''} ${todo.urgent ? 'urgent' : ''}`}>
      <div className="todo-content">
        <button
          type="button"
          className="todo-checkbox"
          onClick={() => !todo.completed && onComplete(todo.id)}
          disabled={todo.completed}
        >
          {todo.completed ? '\u2713' : '\u25CB'}
        </button>
        <span className="todo-text">{todo.text}</span>
        {todo.urgent && <span className="badge badge-urgent">URGENT</span>}
      </div>
      <div className="todo-meta">
        <span className="meta-tab" title={todo.createdBy}>
          by {creatorShort}
        </span>
        {todo.completedBy && (
          <span className="meta-tab" title={todo.completedBy}>
            done by {completerShort}
          </span>
        )}
        <button type="button" className="todo-delete" onClick={() => onDelete(todo.id)}>
          x
        </button>
      </div>
    </li>
  );
}
