import { LoaderCircle, Sparkles } from 'lucide-react';

export default function WorkspaceDataState({
  loading = false,
  fallback = false,
  title = 'Loading the latest information',
  detail = 'Connecting to the latest city data. Your workspace will update automatically.',
  fallbackTitle = 'Sample view is active',
  fallbackDetail = 'Example values are shown for now. The latest available data will replace them automatically when it arrives.',
}) {
  if (loading && !fallback) {
    return <div className="workspace-data-state is-loading" role="status" aria-live="polite">
      <span className="workspace-data-state-icon"><LoaderCircle size={20}/></span>
      <span className="workspace-data-state-copy"><b>{title}</b><small>{detail}</small></span>
      <span className="workspace-data-state-pulse" aria-hidden="true"><i/><i/><i/></span>
    </div>;
  }
  if (fallback) {
    return <div className="workspace-data-state is-sample" role="status" aria-live="polite">
      <span className="workspace-data-state-icon"><Sparkles size={19}/></span>
      <span className="workspace-data-state-copy"><b>{fallbackTitle}</b><small>{fallbackDetail}</small></span>
      <span className="workspace-data-state-tag">REFERENCE</span>
    </div>;
  }
  return null;
}
