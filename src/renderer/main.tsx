import { StrictMode, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerBuiltinWidgets } from './widgets/builtins';

registerBuiltinWidgets(); // must run before first render

/** Catch any unhandled React render errors and show them instead of a blank screen. */
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KarnForge] Unhandled render error:', error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#f87171', background: '#0d0d0d', minHeight: '100vh' }}>
          <h2 style={{ color: '#fca5a5', marginBottom: 16 }}>⚠ Render error — check DevTools console for details</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, opacity: 0.85 }}>{String(error)}</pre>
          <button
            style={{ marginTop: 24, padding: '8px 20px', background: '#1a1d22', color: '#e5e2e1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.state.error === null ? this.props.children : null;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
