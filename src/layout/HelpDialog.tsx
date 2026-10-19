import type { TenantRole } from "../../shared/authContract";
import { AccessibleDialog } from "../components/AccessibleDialog";

export function HelpDialog({ role, onClose }: { role: TenantRole; onClose: () => void }) {
  return <AccessibleDialog title="Ajuda do SocialFlow" onClose={onClose}>
    <h3>Criar e agendar</h3>
    <p>Use Criar publicação, escreva a legenda e selecione os canais conectados e a mídia compatível. Escolha Publicar agora ou Agendar com data e hora futuras.</p>
    <h3>Consultar e gerenciar</h3>
    <p>Em Publicações, abra o menu da publicação para consultar seus detalhes e os resultados por destino. A busca pesquisa título e legenda nos posts carregados do Workspace atual.</p>
    <p>{role === "member"
      ? "Como membro, você pode editar ou excluir somente os seus próprios agendamentos elegíveis."
      : "Como proprietário ou administrador, você pode editar ou excluir agendamentos de qualquer membro, quando elegíveis."}</p>
    <p>Um envio já iniciado impede edição e exclusão. Publicações publicadas, com falha ou canceladas são somente leitura; não há reenvio manual.</p>
    <p>Excluir agendamento retira o post da agenda e impede seu envio; não exclui conteúdo das redes sociais. As permissões e o estado são confirmados pelo servidor.</p>
    <h3>Canais e Workspace</h3>
    <p>Em Canais, conecte Facebook e Instagram pela Meta e consulte o estado da conexão. Se houver mais de um Workspace, use o seletor na barra lateral para trocar de contexto.</p>
    <p>Analytics, TikTok, automações e alterações de configurações ainda não estão disponíveis. Notificações não possuem eventos disponíveis nesta versão.</p>
    <button className="secondary-button" type="button" onClick={onClose}>Fechar ajuda</button>
  </AccessibleDialog>;
}
