import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class WorkspaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the workspace available and preserve details for local debugging.
    console.error('UrbanSaarthi workspace render error:', error, info?.componentStack || '');
  }

  retry = () => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));

  render() {
    if (this.state.error) {
      return <section className="workspace-error-fallback" role="alert">
        <span className="workspace-error-icon"><AlertTriangle size={21}/></span>
        <div><b>This section could not be displayed</b><p>Your other workspaces are still available. Try opening this section again.</p></div>
        <button type="button" onClick={this.retry}><RefreshCw size={14}/> Try again</button>
      </section>;
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
