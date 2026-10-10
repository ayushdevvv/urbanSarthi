import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast" role="status"><Check size={16} />{toast}</div>;
}

export function ErrorNotice() {
  return null;
}

export function EmptyState({ title = 'No data available', description = 'Explore the city overview and available mobility tools.' }) {
  return <div className="empty-state"><span className="empty-mark">—</span><b>{title}</b><p>{description}</p></div>;
}
