import { Check, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast" role="status"><Check size={16} />{toast}</div>;
}

export function ErrorNotice({ message, action, onRetry }) {
  if (!message) return null;
  return <div className="notice notice-error"><XCircle size={16} /><span>{message}</span>{onRetry && <button onClick={onRetry}>{action || 'Retry'}</button>}</div>;
}

export function EmptyState({ title = 'No data available', description = 'This information will appear when the connected API provides it.' }) {
  return <div className="empty-state"><span className="empty-mark">—</span><b>{title}</b><p>{description}</p></div>;
}
