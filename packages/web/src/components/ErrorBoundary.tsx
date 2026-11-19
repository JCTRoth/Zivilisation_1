import React from 'react';
import { t } from '@/i18n';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error details
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);
    
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI. Class component, so it reads the module-level `t`
      // directly (no hook available) — the crash screen is rendered once.
      return (
        <div className="alert alert-danger m-3">
          <h2>{t('errorBoundary.title')}</h2>
          <details className="mt-3">
            <summary className="btn btn-outline-danger">{t('errorBoundary.showDetails')}</summary>
            <div className="mt-2">
              <p><strong>{t('errorBoundary.errorLabel')}</strong> {this.state.error && this.state.error.toString()}</p>
              <p><strong>{t('errorBoundary.stackLabel')}</strong></p>
              <pre className="bg-light p-2 border">
                {this.state.errorInfo?.componentStack || t('errorBoundary.noStack')}
              </pre>
            </div>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
