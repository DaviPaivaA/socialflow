type ToastProps = {
  message: string;
};

export function Toast({ message }: ToastProps) {
  return (
    <div className="toast" role="status">
      <span>✓</span>
      {message}
    </div>
  );
}
