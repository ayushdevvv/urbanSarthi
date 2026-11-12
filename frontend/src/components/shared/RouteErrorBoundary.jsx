import { Component } from 'react';

/** Keeps a single route failure from producing a completely blank workspace. */
export default class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error : new Error('Unknown rendering error') };
  }

  componentDidCatch(error, info) {
    // Keep the detail available to browser diagnostics without exposing internals in the UI.
    console.error('UrbanSaarthi route rendering failed:', error, info?.componentStack || '');
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="content" role="alert" style={{ padding: '32px 4vw' }}>
      <section className="panel" style={{ maxWidth: 760, margin: '0 auto', padding: 28 }}>
        <span className="eyebrow">TRAFFIC INTELLIGENCE</span>
        <h1 style={{ margin: '10px 0 8px' }}>Traffic Lab could not load</h1>
        <p style={{ maxWidth: 560, color: 'var(--muted, #69786f)' }}>
          The page hit a rendering error. Your saved reports have not been deleted. Retry the page or return to the city overview.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
          <button className="primary" type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <a className="secondary" href="/authority/control">City overview</a>
        </div>
      </section>
    </main>;
  }
}
