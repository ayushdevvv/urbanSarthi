import { Check, Database, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast" role="status"><Check size={16} />{toast}</div>;
}

export function ErrorNotice({ message, action, onRetry }) {
  if (!message) return null;
  const isDemoFallback = message.startsWith('DEMO_FALLBACK:');
  const cleanMessage = isDemoFallback ? message.replace('DEMO_FALLBACK: ', '') : message;
  return <div className={`notice ${isDemoFallback ? 'notice-demo' : 'notice-error'}`}>{isDemoFallback ? <Database size={16} /> : <XCircle size={16} />}<span>{cleanMessage}</span>{onRetry && <button onClick={onRetry}>{action || (isDemoFallback ? 'Retry live API' : 'Retry')}</button>}</div>;
}

export function EmptyState({ title = 'No data available', description = 'This information will appear when the connected API provides it.' }) {
  return <div className="empty-state"><span className="empty-mark">—</span><b>{title}</b><p>{description}</p></div>;
}
