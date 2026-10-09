import { Check, Database, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast" role="status"><Check size={16} />{toast}</div>;
}

export function ErrorNotice({ message, action, onRetry }) {
  if (!message) return null;
  const isFallback = message.startsWith('SAMPLE_FALLBACK:') || message.startsWith('DEMO_FALLBACK:');
  const cleanMessage = isFallback
    ? 'Live data is temporarily unavailable. Current scenario estimates remain available.'
    : 'This section could not refresh. The available information is still shown.';
  return <div className={`notice ${isFallback ? 'notice-demo' : 'notice-error'}`} role="status">
    {isFallback ? <Database size={16} /> : <XCircle size={16} />}
    <span>{cleanMessage}</span>
    {onRetry && <button onClick={onRetry}>{action || 'Refresh'}</button>}
  </div>;
}

export function EmptyState({ title = 'No data available', description = 'This information will appear when the connected API provides it.' }) {
  return <div className="empty-state"><span className="empty-mark">—</span><b>{title}</b><p>{description}</p></div>;
}
