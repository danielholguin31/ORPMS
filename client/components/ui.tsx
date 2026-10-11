import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleSlash, X } from 'lucide-react';
import type { Member, TaskStatus } from '../../shared/types';
import { TASK_LABELS } from '../../shared/rules';
import type { QueryState } from '../queries';

export function QueryNotice({ query }: { query: QueryState<unknown> }) {
  if (query.error)
    return (
      <div className="query-error" role="alert">
        <span>{query.error}</span>
        <button className="text-button" onClick={query.retry}>
          Retry
        </button>
      </div>
    );
  if (query.loading && !query.result)
    return (
      <div className="query-loading" role="status">
        <span className="spinner" />
        Loading…
      </div>
    );
  return null;
}

export function StatusIcon({ status, size = 15 }: { status: TaskStatus; size?: number }) {
  const Icon =
    { todo: CircleDashed, in_progress: CircleDot, done: CircleCheck, canceled: CircleSlash }[
      status
    ] || Circle;
  return <Icon size={size} className={`status-icon ${status}`} aria-hidden="true" />;
}
export function Status({ status }: { status: TaskStatus }) {
  return (
    <span className="status-label">
      <StatusIcon status={status} />
      {TASK_LABELS[status]}
    </span>
  );
}
export function Avatar({ member, small = false }: { member?: Member; small?: boolean }) {
  if (!member)
    return (
      <span className={`avatar unassigned ${small ? 'small' : ''}`} aria-label="Unassigned">
        –
      </span>
    );
  const initials = member.displayName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <span
      className={`avatar tone-${member.id.charCodeAt(member.id.length - 1) % 3} ${small ? 'small' : ''}`}
      title={member.displayName}
      aria-label={member.displayName}
    >
      {initials}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  children,
  label,
  onClose,
  onConfirm,
  destructive = false,
}: {
  title: string;
  children: ReactNode;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<any>;
  destructive?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-body">
        <p>{children}</p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`button ${destructive ? 'danger' : 'primary'}`}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
              setPending(false);
            }
          }}
        >
          {pending ? 'Saving…' : label}
        </button>
      </div>
    </Dialog>
  );
}
export function SafeText({ text }: { text: string }) {
  const tokens = text.split(/(https?:\/\/[^\s<>]+)/g);
  return (
    <span className="plain-text">
      {tokens.map((token, i) =>
        /^https?:\/\//.test(token) ? (
          <a key={i} href={token} target="_blank" rel="noopener noreferrer">
            {token}
          </a>
        ) : (
          token
        ),
      )}
    </span>
  );
}
export const taskCode = (id: string) => `OR-${id.slice(-6).toUpperCase()}`;
export function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null;
}
