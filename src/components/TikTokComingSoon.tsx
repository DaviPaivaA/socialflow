import { useId, useState } from "react";
import { ChannelBadge } from "./ChannelBadge";

export function TikTokComingSoon() {
  const descriptionId = useId();
  const [informed, setInformed] = useState(false);
  return (
    <div className="upcoming-channel">
      <button
        aria-describedby={descriptionId}
        aria-disabled="true"
        aria-label="Conectar TikTok"
        className="secondary-button"
        onClick={() => setInformed(true)}
        type="button"
      >
        <ChannelBadge code="TT" small />
        <span>Conectar TikTok</span>
      </button>
      <p id={descriptionId}>
        Conexão indisponível.
      </p>
      {informed && <p role="status">Conexão TikTok indisponível.</p>}
    </div>
  );
}
