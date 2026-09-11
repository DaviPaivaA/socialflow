type NotFoundProps = {
  onGoHome: () => void;
};

export function NotFound({ onGoHome }: NotFoundProps) {
  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div>
          <span>ROTA INEXISTENTE</span>
          <h2>Não encontramos esta página.</h2>
        </div>
        <button className="primary-button" onClick={onGoHome} type="button">
          Voltar à visão geral
        </button>
      </div>
      <p>
        Confira o endereço ou use o menu para continuar navegando pelo
        SocialFlow.
      </p>
    </section>
  );
}
