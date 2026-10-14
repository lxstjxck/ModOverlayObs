export function LoadingSpinner({ className = "" }: { className?: string }) {
  return <span className={`lxst-spinner ${className}`} aria-hidden="true" />;
}

export function LoadingScreen({ message }: { message: string }) {
  return <main className="lxst-loading-screen" role="status">
    <LoadingSpinner className="lxst-spinner-large" />
    <span>{message}</span>
  </main>;
}
