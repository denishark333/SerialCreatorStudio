export const LEGAL_VERSION = '2026-11-16';
const escape = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function createLegal({
  supportEmail = 'contato.serialhealer@gmail.com',
  backupsConfirmed = false,
  publicOrigin = 'https://www.serialhealer.com.br',
} = {}) {
  const base = publicOrigin.replace(/\/$/, '') + '/api/v1/legal';
  const metadata = {
    version: LEGAL_VERSION,
    supportEmail,
    backupRetentionDays: 7,
    backupsConfirmed,
    privacyUrl: base + '/privacy',
    termsUrl: base + '/terms',
  };
  function page(kind) {
    const privacy = kind === 'privacy',
      title = privacy ? 'Política de privacidade' : 'Termos de uso';
    const contact = '<a href="mailto:' + escape(supportEmail) + '">' + escape(supportEmail) + '</a>';
    const body = privacy
      ? `<h2>Dados e finalidade</h2><p>A Serial Creator Studio utiliza YouTube API Services e integrações Twitch/Kick para identificar os canais autorizados, consultar conteúdos, comentários, membros quando autorizados, métricas e receitas estimadas. Também armazena os planos e registros financeiros que você cria. Os dados são usados para exibir e administrar seu próprio estúdio.</p><p>Senhas das plataformas não são solicitadas. Tokens OAuth são armazenados criptografados na VPS. A sessão do Creator Studio fica em memória, e a preferência de plataforma pode ser salva no dispositivo e no servidor. Dados dos canais em cache no Client ficam em memória durante a sessão. Pessoas que autorizarem a união de estúdios passam a acessar os dados desse mesmo estúdio.</p><h2>Uso e compartilhamento</h2><p>Não vendemos seus dados nem os usamos para publicidade direcionada. As ações solicitadas usam os serviços correspondentes e a infraestrutura de hospedagem do responsável. O acesso aos estúdios é separado por sessão; operadores autorizados da infraestrutura podem ter acesso técnico aos dados necessários à manutenção. Esta versão não envia dados dos canais para curadoria por IA.</p><h2>Retenção</h2><p>Relatórios e dados importados são atualizados pela sincronização. Registros importados cuja última coleta tem mais de 30 dias são removidos pela manutenção automática. Identificadores de conexão e login, preferências, aceites, planos e registros criados por você permanecem enquanto seu estúdio existir, até que você os remova ou solicite a exclusão.</p><h2>Desconectar e excluir</h2><p>Em Conexões, desconectar remove os dados ativos relacionados à conexão e encerra as sessões do estúdio. Se for a última conexão, o estúdio pessoal também é removido. Excluir o estúdio remove seus dados ativos, inclusive planos, registros financeiros e dados de estúdios unidos. Isso não apaga vídeos, comentários, canais ou contas nas plataformas.</p><p>A revogação das credenciais de acesso é solicitada às plataformas. Se estiverem indisponíveis, apenas as credenciais criptografadas necessárias para novas tentativas ficam numa fila privada por até seis dias. Essas credenciais são descartadas em até sete dias. A Twitch oferece revogação do access token; para revisar ou remover a autorização da aplicação na própria plataforma, use também suas configurações de conexões. Uma nova autorização pode criar um novo estúdio.</p><p>Os backups são geridos pelo responsável na hospedagem, com prazo operacional máximo de sete dias. A aplicação não controla cópias externas ao seu armazenamento ativo. Entre em contato para acompanhar um pedido de exclusão e eventuais cópias de segurança. Ao restaurar backups, o operador deve reaplicar as exclusões antes de disponibilizar o serviço.</p><p>Um registro técnico separado mantém resumos criptográficos dos identificadores e datas das exclusões por sete dias, para impedir que uma restauração do armazenamento ativo reintroduza dados apagados. Credenciais pendentes de revogação podem constar criptografadas nesse registro temporário e são removidas após a confirmação ou expiração.</p><h2>Seus controles e contato</h2><p>Você também pode revogar o acesso Google nas <a href="https://security.google.com/settings/security/permissions">configurações de segurança da sua conta</a>. Consulte a <a href="https://policies.google.com/privacy">Política de Privacidade do Google</a>. Para acesso, correção, exclusão ou dúvidas, fale com ${contact}.</p>`
      : `<h2>Uso do Creator Studio</h2><p>A Serial Creator Studio reúne os dados dos canais que você autoriza e utiliza YouTube API Services. Ao usar a integração YouTube, você concorda também com os <a href="https://www.youtube.com/t/terms">Termos de Serviço do YouTube</a>. Aplicam-se ainda os termos das demais plataformas conectadas.</p><p>Conecte apenas contas que você pode administrar. A união de estúdios reúne seus canais e dados; confirme somente se deseja esse compartilhamento entre os métodos de login. Respostas e moderação publicadas por sua solicitação podem afetar o conteúdo real nas plataformas.</p><h2>Disponibilidade e valores</h2><p>Dados podem sofrer atraso, depender de permissões, cotas ou da disponibilidade das APIs. Receitas da plataforma são estimativas quando assim identificadas; pagamentos e parcerias registrados manualmente não confirmam transferências bancárias. A lista de membros depende da autorização específica do YouTube e não informa receita líquida.</p><h2>Conta e privacidade</h2><p>Você pode desconectar integrações ou excluir os dados do seu estúdio em Conexões. Leia a <a href="${base}/privacy">Política de Privacidade</a> para entender os dados armazenados, os prazos e as limitações de backups. Heart e Pin ainda são atalhos externos nesta versão; não são anunciados como ações da API oficial.</p><h2>Suporte</h2><p>Para dúvidas ou pedidos relacionados aos dados: ${contact}.</p>`;
    return (
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      title +
      ' · Serial Creator Studio</title><style>body{margin:0;background:#141a22;color:#edf0f4;font:16px/1.75 system-ui,sans-serif}main{max-width:850px;margin:32px auto;padding:32px;border:1px solid #ffffff20;border-radius:24px;background:#26313b70}h1{font-size:32px;line-height:1.2}h2{font-size:20px;margin-top:30px}a{color:#b4f500}p{color:#cbd2da}hr{border:0;border-top:1px solid #ffffff20}@media(max-width:600px){main{margin:10px;padding:20px}h1{font-size:26px}}</style><body><main><p>Serial Creator Studio · Versão ' +
      LEGAL_VERSION +
      '</p><h1>' +
      title +
      '</h1>' +
      (!backupsConfirmed
        ? '<p><strong>Versão de validação:</strong> a confirmação operacional da retenção dos backups ainda está pendente. A abertura pública do aplicativo permanece pendente.</p>'
        : '') +
      body +
      '<hr><p><a href="' +
      base +
      '/privacy">Privacidade</a> · <a href="' +
      base +
      '/terms">Termos</a></p></main></body></html>'
    );
  }
  return { metadata, page };
}
