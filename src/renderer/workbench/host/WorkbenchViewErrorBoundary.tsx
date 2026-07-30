import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

interface WorkbenchViewErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (message: string) => void;
}

interface WorkbenchViewErrorBoundaryState {
  readonly failed: boolean;
  readonly retryKey: number;
}

export class WorkbenchViewErrorBoundary extends Component<
  WorkbenchViewErrorBoundaryProps,
  WorkbenchViewErrorBoundaryState
> {
  state: WorkbenchViewErrorBoundaryState = {
    failed: false,
    retryKey: 0,
  };

  static getDerivedStateFromError(): Partial<WorkbenchViewErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('资料工作台 Renderer 运行异常', error, info);
    this.props.onError('资料工作台显示异常，请重试。');
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center p-8 text-center">
          <div>
            <p className="text-sm text-rose-300">
              资料工作台显示异常
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState((state) => ({
                  failed: false,
                  retryKey: state.retryKey + 1,
                }));
              }}
              className="ui-primary-button mt-4 rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-900"
            >
              重新加载工作台
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={this.state.retryKey} className="h-full min-h-0">
        {this.props.children}
      </div>
    );
  }
}
