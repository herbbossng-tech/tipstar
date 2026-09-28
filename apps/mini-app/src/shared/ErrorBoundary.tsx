import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * Root error boundary (Section 01 — Frontend Foundation). Never shows a
 * stack trace or internal error detail to the user — only a safe message
 * and a recovery action.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="state state--error" role="alert">
          <p className="state__title">Something went wrong</p>
          <p className="state__message">This screen couldn't be displayed. You can try again.</p>
          <button type="button" className="button button--secondary" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
