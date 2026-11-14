import { LoaderCircle } from 'lucide-react';
import './inline-loading-indicator.css';

export default function InlineLoadingIndicator({ label = 'Loading', compact = false, className = '' }) {
  return <div className={`us-inline-loader ${compact ? 'compact' : ''} ${className}`.trim()} role="status" aria-live="polite">
    <LoaderCircle size={compact ? 15 : 19} strokeWidth={2} aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
