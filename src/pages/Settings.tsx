import { settingPreferences } from "../data/mockData";

export function Settings() {
  return (
    <section className="settings-layout">
      <article className="panel settings-card">
        <div className="section-heading"><div><span>PERFIL</span><h2>Área de trabalho</h2></div></div>
        <label className="field-label">Nome da marca<input defaultValue="Café Aurora" /></label>
        <label className="field-label">Fuso horário<select defaultValue="America/Sao_Paulo"><option value="America/Sao_Paulo">Brasília (GMT−3)</option></select></label>
        <button className="primary-button" type="button">Salvar alterações</button>
      </article>
      <article className="panel settings-card">
        <div className="section-heading"><div><span>AUTOMAÇÕES</span><h2>Preferências de publicação</h2></div></div>
        {settingPreferences.map(({ title, description }, index) => (
          <label className="switch-row" key={title}>
            <span><strong>{title}</strong><small>{description}</small></span>
            <input type="checkbox" defaultChecked={index !== 1} /><i />
          </label>
        ))}
      </article>
    </section>
  );
}
