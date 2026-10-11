import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Search } from 'lucide-react';
import type { SearchResult } from '../../shared/types';
import { useApiQuery } from '../queries';
import { Dialog, QueryNotice, StatusIcon } from './ui';

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(''),
    [requestedQuery, setRequestedQuery] = useState(''),
    [selected, setSelected] = useState(0),
    [openWhenReady, setOpenWhenReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRequestedQuery(query), 120);
    return () => clearTimeout(timer);
  }, [query]);
  const read = useApiQuery<SearchResult[]>(`/search?q=${encodeURIComponent(requestedQuery)}`);
  const results = query === requestedQuery ? read.result || [] : [];
  const choose = (path: string) => {
    navigate(path);
    onClose();
  };
  useEffect(() => {
    if (openWhenReady && query === requestedQuery && !read.loading) {
      setOpenWhenReady(false);
      const result = read.result?.[selected];
      if (result) choose(result.path);
    }
  }, [openWhenReady, query, requestedQuery, read.result, read.loading, selected]);
  return (
    <Dialog title="Search" onClose={onClose} className="search-dialog">
      <div className="search-input">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search tasks and projects"
          placeholder="Tasks and projects"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
            setOpenWhenReady(false);
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
            if (e.key === 'Enter') {
              e.preventDefault();
              if (query !== requestedQuery || read.loading) {
                setRequestedQuery(query);
                setOpenWhenReady(true);
              } else if (results[selected]) choose(results[selected].path);
            }
          }}
        />
      </div>
      <div className="search-results">
        <QueryNotice query={read} />
        {results.map((result, i) => (
          <button
            key={result.id}
            className={selected === i ? 'selected' : ''}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(result.path)}
          >
            {result.kind === 'project' ? (
              <FolderKanban size={17} />
            ) : (
              <StatusIcon status={result.status!} />
            )}
            <span>{result.title}</span>
            <small>{result.context}</small>
          </button>
        ))}
        {read.result && !read.loading && query === requestedQuery && !results.length && (
          <p>No results</p>
        )}
      </div>
    </Dialog>
  );
}
