import type { ComposerDestinationsState } from "./useComposerDestinations";

type ComposerDestinationsProps = {
  destinations: ComposerDestinationsState;
  onToggle: (id: string) => void;
};

export function ComposerDestinations({ destinations, onToggle }: ComposerDestinationsProps) {
  return <section aria-label="Destinos" className="composer-destinations">
    <strong>Facebook Pages</strong>
    {destinations.isLoading ? <p role="status">Carregando Pages conectadas...</p> : null}
    {destinations.error ? <p role="alert">{destinations.error} Abra Canais e tente novamente.</p> : null}
    {!destinations.isLoading && !destinations.error && destinations.facebookPages.length === 0
      ? <p>Não há Facebook Pages conectadas. Abra Canais para conectar uma Page.</p>
      : null}
    {destinations.facebookPages.length > 0 ? <div className="composer-page-list">
      {destinations.facebookPages.map((page) => <label className="composer-page" key={page.id}>
        <input
          checked={destinations.selectedIds.includes(page.id)}
          onChange={() => onToggle(page.id)}
          type="checkbox"
        />
        <span>{page.displayName}</span>
      </label>)}
    </div> : null}
  </section>;
}
