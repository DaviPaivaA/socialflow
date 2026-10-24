import type { ComposerDestinationsState } from "./useComposerDestinations";
import { TikTokComingSoon } from "../../components/TikTokComingSoon";

type ComposerDestinationsProps = {
  destinations: ComposerDestinationsState;
  onToggle: (id: string) => void;
};

export function ComposerDestinations({ destinations, onToggle }: ComposerDestinationsProps) {
  return <section aria-label="Destinos" className="composer-destinations">
    <strong>Facebook e Instagram</strong>
    {destinations.isLoading ? <p role="status">Carregando contas conectadas...</p> : null}
    {destinations.error ? <p role="alert">{destinations.error} Abra Canais e tente novamente.</p> : null}
    {!destinations.isLoading && !destinations.error && destinations.accounts.length === 0
      ? <p>Não há contas elegíveis de Facebook ou Instagram. Abra Canais para conectar ou reconectar uma conta.</p>
      : null}
    {destinations.reconnectionRequired ? <p role="status">Algumas contas precisam de reconexão ou permissões de publicação. Reconecte em Canais.</p> : null}
    {destinations.accounts.length > 0 ? <div className="composer-page-list">
      {destinations.accounts.map((page) => <label className="composer-page" key={page.id}>
        <input
          checked={destinations.selectedIds.includes(page.id)}
          onChange={() => onToggle(page.id)}
          type="checkbox"
        />
        <span>{page.provider === "facebook" ? `Facebook — ${page.displayName}` : `Instagram — ${page.username ? `@${page.username}` : page.displayName}`}</span>
      </label>)}
    </div> : null}
    {!destinations.isLoading && destinations.unavailableSelectedIds.map((id) => <div className="composer-unavailable-selection" key={id}>
      <p>Conta selecionada indisponível — {id}. Remova a seleção ou reconecte em Canais.</p>
      <button type="button" onClick={() => onToggle(id)}>Remover conta {id}</button>
    </div>)}
    <TikTokComingSoon />
  </section>;
}
