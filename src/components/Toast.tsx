export type ToastVariant = "success" | "error";

type ToastProps = {
  message: string;
  variant: ToastVariant;
};

export function Toast({ message, variant }: ToastProps) {
  return (
    <div
      className={`toast toast--${variant}`}
      role={variant === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true">{variant === "error" ? "!" : "✓"}</span>
      {message}
    </div>
  );
}
