import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { HttpError } from "../data/api/apiClient";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (displayName.trim().length < 2) {
      setError("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Informe um email válido.");
      return;
    }
    if (password.length < 12) {
      setError("A senha deve ter pelo menos 12 caracteres.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("A confirmação de senha não corresponde à senha informada.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await register({ displayName: displayName.trim(), email, password });
      navigate("/", { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof HttpError && caughtError.status === 409
          ? "Já existe uma conta com este email."
          : caughtError instanceof HttpError && caughtError.status === 429
            ? "Muitas tentativas. Aguarde um instante antes de tentar novamente."
          : caughtError instanceof HttpError && caughtError.status === 400
            ? "Revise os dados informados e tente novamente."
            : "Não foi possível criar sua conta agora. Tente novamente.",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="register-title">
        <div className="auth-brand">
          <div className="brand-mark"><i /><i /><i /></div>
          <strong>Social<span>Flow</span></strong>
        </div>
        <span className="auth-eyebrow">NOVO WORKSPACE</span>
        <h1 id="register-title">Criar conta</h1>
        <p>Comece com um workspace próprio para organizar suas publicações.</p>

        <form onSubmit={submit} noValidate>
          <label className="field-label">
            Nome
            <input
              autoComplete="name"
              name="displayName"
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
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
              autoComplete="new-password"
              minLength={12}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label className="field-label">
            Confirmar senha
            <input
              autoComplete="new-password"
              minLength={12}
              name="passwordConfirmation"
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={passwordConfirmation}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button
            aria-busy={isSubmitting}
            className="primary-button auth-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Criando conta..." : "Criar conta"}
          </button>
        </form>

        <p className="auth-alternate">
          Já tem uma conta? <Link to="/login">Entrar</Link>
        </p>
      </section>
    </main>
  );
}
