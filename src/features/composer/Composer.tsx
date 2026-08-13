import { useState } from "react";
import type { FormEvent } from "react";
import { ChannelBadge } from "../../components/ChannelBadge";
import { channelCodes, channelMeta } from "../../data/mockData";
import type { ChannelCode, Post } from "../../types/social";

type ComposerProps = {
  onClose: () => void;
  onSchedule: (post: Post) => void;
};

export function Composer({ onClose, onSchedule }: ComposerProps) {
  const [caption, setCaption] = useState("");
  const [date, setDate] = useState("2026-08-13");
  const [time, setTime] = useState("10:00");
  const [selected, setSelected] = useState<ChannelCode[]>(["IG", "FB"]);

  const toggleChannel = (code: ChannelCode) => {
    setSelected((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!caption.trim() || selected.length === 0) return;

    onSchedule({
      id: Date.now(),
      title:
        caption.trim().split(/[.!?]/)[0].slice(0, 38) || "Nova publicação",
      caption: caption.trim(),
      date: new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      })
        .format(new Date(date + "T12:00:00Z"))
        .replace(".", ""),
      time,
      channels: selected,
      status: "Agendado",
      color: "purple",
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="composer-modal" onSubmit={submit}>
        <div className="modal-header">
          <div><span>NOVO CONTEÚDO</span><h2>Criar publicação</h2></div>
          <button aria-label="Fechar" onClick={onClose} type="button">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-fields">
            <div className="field-label">
              <span>Publicar em</span>
              <div className="channel-selector">
                {channelCodes.map((code) => (
                  <button className={selected.includes(code) ? "selected" : ""} onClick={() => toggleChannel(code)} type="button" key={code}>
                    <ChannelBadge code={code} small /> {channelMeta[code].name}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-label">Legenda<textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Conte a história por trás desta publicação..." maxLength={500} required /><small>{caption.length}/500</small></label>
            <div className="date-fields">
              <label className="field-label">Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="field-label">Horário<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
            </div>
            <div className="best-time"><span>✦</span><div><strong>Sugestão inteligente</strong><p>10:00 tem 18% mais engajamento às quintas-feiras.</p></div></div>
          </div>
          <div className="composer-preview">
            <span>PRÉ-VISUALIZAÇÃO</span>
            <div className="social-preview">
              <div className="social-user"><div className="avatar tiny">CA</div><div><strong>cafeaurora</strong><span>Patrocinado</span></div><b>•••</b></div>
              <div className="preview-canvas"><span>☕</span><p>PAUSAS QUE<br /><b>RENOVAM.</b></p></div>
              <div className="social-actions">♡　⌁　➤ <span>▣</span></div>
              <p><strong>cafeaurora</strong> {caption || "Sua legenda aparecerá aqui..."}</p>
            </div>
          </div>
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose} type="button">Salvar rascunho</button><button className="primary-button" type="submit">▦ Agendar publicação</button></div>
      </form>
    </div>
  );
}
