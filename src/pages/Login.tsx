import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { HttpError } from "../data/api/apiClient";

type RedirectState = { from?: unknown };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRedirectPath(state: unknown): string {
  const from = (state as RedirectState | null)?.from;
  return typeof from === "string" && /^\/(?!\/)/.test(from) ? from : "/";
}

export function Login() {
  const { initializationError, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!EMAIL_PATTERN.test(email.trim()) || password.length < 12) {
      setError("Informe um email válido e uma senha com pelo menos 12 caracteres.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      navigate(getRedirectPath(location.state), { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof HttpError && caughtError.status === 401
          ? "Email ou senha inválidos."
          : caughtError instanceof HttpError && caughtError.status === 429
            ? "Muitas tentativas. Aguarde um instante antes de tentar novamente."
          : caughtError instanceof HttpError && caughtError.status === 400
            ? "Revise o email e a senha informados."
          : "Não foi possível entrar agora. Verifique o servidor e tente novamente.",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <div className="brand-mark"><i /><i /><i /></div>
          <strong>Social<span>Flow</span></strong>
        </div>
        <span className="auth-eyebrow">BEM-VINDO DE VOLTA</span>
        <h1 id="login-title">Entrar</h1>
        <p>Acesse seu workspace e continue planejando seu conteúdo.</p>

        <form onSubmit={submit} noValidate>
          <label className="field-label">
            Email
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="field-label">
            Senha
            <input
              autoComplete="current-password"
              minLength={12}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {(error || initializationError) && (
            <p className="auth-error" role="alert">
              {error ?? initializationError}
            </p>
          )}
          <button
            aria-busy={isSubmitting}
            className="primary-button auth-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="auth-alternate">
          Ainda não tem uma conta? <Link to="/register">Criar conta</Link>
        </p>
      </section>
    </main>
  );
}
