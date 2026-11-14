import { Sparkles } from 'lucide-react';
import PremiumLoadingScreen from './PremiumLoadingScreen.jsx';

export default function WorkspaceDataState({
  loading = false,
  fallback = false,
  title = 'Loading the latest information',
  detail = 'Connecting to the latest city data.',
  fallbackTitle = 'Continuity view active',
  fallbackDetail = 'A local reference view is available while this service is unavailable.',
}) {
  if (loading) return <PremiumLoadingScreen title={title} detail={detail}/>;
  if (fallback) {
    return <div className="workspace-data-state is-reference" role="status" aria-live="polite">
      <span className="workspace-data-state-icon"><Sparkles size={19}/></span>
      <span className="workspace-data-state-copy"><b>{fallbackTitle}</b><small>{fallbackDetail}</small></span>
      <span className="workspace-data-state-tag">REFERENCE</span>
    </div>;
  }
  return null;
}
