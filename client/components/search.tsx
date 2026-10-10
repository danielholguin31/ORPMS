import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Search } from 'lucide-react';
import { useApp } from '../context';
import { Dialog, StatusIcon, taskCode } from './ui';

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { data } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0);
  const q = query.toLowerCase().trim();
  const results = [
    ...data.projects
      .filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        title: p.name,
        context: p.archivedAt ? 'Archived project' : 'Project',
        path: `/projects/${p.id}`,
        icon: <FolderKanban size={17} />,
      })),
    ...data.tasks
      .filter(
        (t) => !t.deletedAt && `${t.title} ${t.id} ${taskCode(t.id)}`.toLowerCase().includes(q),
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        context: data.projects.find((p) => p.id === t.projectId)?.name || '',
        path: `/tasks/${t.id}`,
        icon: <StatusIcon status={t.status} />,
      })),
  ].slice(0, 15);
  const choose = (path: string) => {
    navigate(path);
    onClose();
  };
  return (
    <Dialog title="Find anything" onClose={onClose} className="search-dialog">
      <div className="search-input">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search tasks and projects"
          placeholder="Search tasks and projects…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((selected + 1) % Math.max(1, results.length));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected(
                (selected + Math.max(1, results.length) - 1) % Math.max(1, results.length),
              );
            }
            if (e.key === 'Enter' && results[selected]) {
              e.preventDefault();
              choose(results[selected].path);
            }
          }}
        />
      </div>
      <div className="search-results">
        {results.map((result, i) => (
          <button
            key={result.id}
            className={selected === i ? 'selected' : ''}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(result.path)}
          >
            {result.icon}
            <span>{result.title}</span>
            <small>{result.context}</small>
          </button>
        ))}
        {!results.length && <p>No tasks or projects match “{query}”.</p>}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>↵</kbd> Open
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </div>
    </Dialog>
  );
}
