import { useId, useState } from "react";
import { ChannelBadge } from "./ChannelBadge";

export function TikTokComingSoon() {
  const descriptionId = useId();
  const [informed, setInformed] = useState(false);
  return (
    <div className="upcoming-channel">
      <button
        aria-describedby={descriptionId}
        aria-label="Conectar TikTok"
        className="secondary-button"
        onClick={() => setInformed(true)}
        type="button"
      >
        <ChannelBadge code="TT" small />
        <span>Conectar TikTok</span>
      </button>
      <p id={descriptionId}>
        Integração em desenvolvimento. Conexão, publicação e métricas indisponíveis.
      </p>
      {informed && <p role="status">A integração TikTok não está habilitada neste ambiente. Nenhuma conexão foi iniciada.</p>}
    </div>
  );
}
