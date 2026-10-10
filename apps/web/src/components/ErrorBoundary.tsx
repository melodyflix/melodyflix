import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('ErrorBoundary:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16, margin: 16,
          background: '#fee2e2', border: '2px solid #dc2626',
          borderRadius: 8, color: '#7f1d1d',
          fontFamily: 'monospace', fontSize: 12,
        }}>
          <h3 style={{ margin: '0 0 8px 0' }}>⚠️ React Error</h3>
          <div style={{ marginBottom: 8 }}><b>{this.state.error.message}</b></div>
          <pre style={{
            padding: 8, background: '#fff', borderRadius: 4,
            overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
          }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
