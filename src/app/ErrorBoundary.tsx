import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Catches a screen that fails to render or to download, and says so, instead of leaving a blank
 * page. One wraps each route.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="message" role="alert">
        <p>Something went wrong showing this page.</p>
        <p className="message-detail">{this.state.error.message}</p>
        <p>
          <a href="#/" onClick={() => this.setState({ error: null })}>
            Back to the library
          </a>
          {" · "}
          <button className="link-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </div>
    );
  }
}
