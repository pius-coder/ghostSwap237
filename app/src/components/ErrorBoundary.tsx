import { Component } from 'react';
import type { ReactNode } from 'react';
import { AppButton } from '@/components/app';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { i18n } from '@/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-lg bg-destructive/10">
              <AlertTriangle className="size-7 text-destructive" />
            </div>
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              {i18n.t('errorBoundary.title')}
            </h1>
            <p className="mb-6 text-[13px] text-muted-foreground">
              {this.state.error?.message || i18n.t('errors.UNEXPECTED')}
            </p>
            <AppButton onClick={this.handleReload}>
              <RefreshCw className="size and-4" />
              {i18n.t('errorBoundary.reload')}
            </AppButton>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
