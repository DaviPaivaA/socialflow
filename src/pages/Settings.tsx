import { settingPreferences } from "../data/mockData";

export function Settings({ workspaceName }: { workspaceName: string }) {
  return (
    <section className="settings-layout">
      <article className="panel settings-card">
        <div className="section-heading"><div><span>PERFIL</span><h2>Área de trabalho</h2></div></div>
        <label className="field-label">Workspace<input value={workspaceName} readOnly /></label>
        <p>Alterações de perfil estarão disponíveis em breve.</p>
        <button className="primary-button" disabled type="button">Salvar alterações</button>
      </article>
      <article className="panel settings-card">
        <div className="section-heading"><div><span>AUTOMAÇÕES</span><h2>Preferências de publicação</h2></div></div>
        <p>Automações ainda não estão disponíveis.</p>
        {settingPreferences.map(({ title, description }) => (
          <label className="switch-row" key={title}>
            <span><strong>{title}</strong><small>{description}</small></span>
            <input type="checkbox" disabled /><i />
          </label>
        ))}
      </article>
    </section>
  );
}
