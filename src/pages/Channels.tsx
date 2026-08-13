import { ChannelBadge } from "../components/ChannelBadge";
import { channelMeta, connectedChannels } from "../data/mockData";

export function Channels() {
  return (
    <section className="channels-grid">
      {connectedChannels.map((channel) => (
        <article className="panel channel-card" key={channel.code}>
          <div className="channel-card-top">
            <ChannelBadge code={channel.code} />
            <span className="connected-dot"><i /> {channel.status}</span>
          </div>
          <h2>{channelMeta[channel.code].name}</h2>
          <p>{channel.user}</p>
          <div className="channel-numbers"><strong>{channel.followers}</strong><span>seguidores</span></div>
          <div className="channel-health"><span>Saúde do canal</span><b>Excelente</b></div>
          <div className="health-track"><i /></div>
          <button className="secondary-button full" type="button">Gerenciar canal</button>
        </article>
      ))}
      <button className="add-channel-card" type="button"><span>＋</span><strong>Conectar novo canal</strong><small>Adicione outro perfil social</small></button>
    </section>
  );
}
