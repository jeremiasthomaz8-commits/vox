# Acesso gratuito pela internet com Supabase

O GitHub guarda o código, a Netlify Free publica a interface e executa a API Node.js, e o Supabase Free guarda os dados compartilhados. Todos os dispositivos usam o mesmo endereço HTTPS, com sessões independentes. Avaliações, contas, auditoria e fotografias criptografadas permanecem no PostgreSQL privado. Não é necessário contratar servidor nem disco na Render.

O Vox deste repositório foi publicado em **[https://vox-louveira.netlify.app/](https://vox-louveira.netlify.app/)** em 13/10/2026, na equipe `jeremiasthomaz8`, plano Free. As variáveis privadas estão restritas ao contexto de produção. O deploy foi feito pela CLI, a partir do código do GitHub; novos pushes no repositório não atualizam automaticamente esta instalação.

## Plano gratuito e limites

Escolha **Free** na Netlify e mantenha o projeto Supabase no plano **Free**. Não selecione testes de planos pagos, upgrades, complementos ou recarga de créditos. Os preços consultados em 11/10/2026 indicam US$ 0 para ambos os planos. A Netlify Free oferece 300 créditos por mês com limite rígido: ao atingir o limite, os projetos da conta pausam até o próximo ciclo, sem cobrança automática de excedentes. Publicações, tráfego e execução das funções consomem esses créditos. Consulte o painel de uso antes de publicar novas versões.

O Supabase também tem limites gratuitos de armazenamento, conexões e tráfego, e pode pausar projetos inativos. Fotografias ocupam espaço no banco. A disponibilidade e a capacidade dependem das cotas dos dois provedores; esta configuração não contrata planos pagos para ultrapassá-las.

## Preparar o projeto Supabase existente

Este projeto já teve os cadastros e acessos migrados. **Não execute novamente a importação em um banco preenchido.** Para uma instalação nova:

1. Aplique os arquivos SQL de `supabase/migrations/` em ordem, uma vez cada. Eles criam somente o schema privado `vox`, sem alterar `public`, `auth` ou outros schemas.
2. Aplique `supabase/vox-app-role.sql` e configure uma senha aleatória para `vox_app` por canal privado. Essa credencial restrita é exclusiva da infraestrutura e não é a senha do diretor.
3. No painel **Connect → Transaction pooler**, copie o host real do projeto, a porta 6543 e o usuário `vox_app.PROJECT_REF`. O pooler transacional é adequado às funções temporárias da Netlify. Não deduza o host pela região.

```dotenv
VOX_DATABASE=supabase
DATABASE_URL=postgresql://vox_app.PROJECT_REF:SENHA_PRIVADA@HOST_DO_POOLER:6543/postgres
```

O driver `pg` verifica a cadeia TLS e o nome do servidor. O certificado público oficial em `supabase/certs/prod-ca-2021.crt` foi obtido pelo download indicado no painel Supabase, SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`, válido até abril de 2031. `DATABASE_CA_CERT` permite substituir a CA por PEM. Atualize a CA conforme o provedor; não desative a verificação TLS.

Todas as tabelas têm RLS. `anon`, `authenticated` e `PUBLIC` não têm acesso ao schema. O navegador usa a API autenticada do Vox e nunca recebe a conexão PostgreSQL. Não adicione `vox` aos schemas expostos pela Data API. O servidor usa consultas parametrizadas sem prepared statements nomeados, transações no mesmo cliente e bloqueios transacionais compatíveis com o pooler.

## Publicar na Netlify Free

1. Entre em [Netlify](https://app.netlify.com/) com sua conta. Escolha **Free** se precisar criar uma equipe.
2. Importe o repositório `jeremiasthomaz8-commits/vox`, branch `main`. O `netlify.toml` define o build `npm run check`, diretório público `public` e funções `netlify/functions`. A versão do Node é 24.21.0.
3. Configure as variáveis abaixo no painel privado da Netlify. Use o contexto **Production** para as credenciais; não disponibilize o banco real para previews de alterações não revisadas. Credenciais nunca entram no Git, arquivos de build públicos ou JavaScript da interface.
4. Publique a versão de produção e habilite o acesso público, se o painel apresentar essa etapa. Use a URL HTTPS `.netlify.app` em qualquer navegador, computador, tablet ou celular.

| Variável | Valor/finalidade |
| --- | --- |
| `NODE_ENV` | `production` |
| `VOX_DATABASE` | `supabase` |
| `DATABASE_URL` | Conexão privada de `vox_app` pelo transaction pooler, porta 6543 |
| `TRUST_PROXY` | `true` |
| `PUBLIC_ORIGIN` | URL HTTPS principal do projeto, por exemplo `https://vox-exemplo.netlify.app` |
| `LEGAL_REVIEW_APPROVED` | `true`, após a revisão municipal |
| `PHOTO_CAPTURE_ENABLED` | `true`, para habilitar o fluxo fotográfico |
| `PHOTO_PRIVACY_APPROVED` | `true`, após a aprovação da política fotográfica |
| `PHOTO_ENCRYPTION_KEY` | Chave original de 32 bytes em base64, preservada fora do banco |
| `AWS_LAMBDA_JS_RUNTIME` | `nodejs24.x`, definido pelo painel/CLI, se necessário explicitar o runtime |

As aprovações municipais deste projeto foram confirmadas pelo responsável. Não gere outra chave se já houver fotografias: uma chave diferente torna as imagens existentes ilegíveis. Os acessos migrados continuam com as mesmas senhas. A publicação não cria contas nem avaliações de demonstração. Contas ainda com senha provisória precisam alterá-la ao entrar.

A API usa o formato moderno de funções `Request`/`Response`, sem iniciar um servidor permanente. O adaptador preserva cookies seguros, CSRF, verificação de origem/Host, IP informado pela plataforma, permissões por perfil, idempotência, auditoria e arquivos binários de fotos/PDF. Cada instância mantém no máximo uma conexão PostgreSQL, com encerramento rápido de conexões ociosas. As fontes Sora e a CA pública são incluídas no pacote privado das funções.

A função agendada `photo-retention` verifica a exclusão de fotos vencidas a cada dez minutos em produção. A API também verifica o vencimento ao iniciar e antes de listar/abrir imagens. Agendamentos dependem de o projeto estar ativo e dentro da cota. O navegador exige sua própria permissão de câmera e a fotografia permanece opcional para o paciente.

`PUBLIC_ORIGIN` restringe o acesso ao domínio principal. Na ausência dessa variável, a função usa a URL principal informada pela Netlify. Para domínio próprio, altere a variável para o domínio HTTPS autorizado e publique novamente.

## Verificação e atualizações

```powershell
npm run check
npm test
npm run test:postgres
```

Os testes usam SQLite ou PostgreSQL PGlite isolados, sem inserir avaliações fictícias no projeto Supabase em uso. Incluem o adaptador de funções, login/logout, cookies, CSRF, origem HTTPS, captura opcional, criptografia, acesso do diretor, bytes de fotos e PDF, exportação CSV e reenvios idempotentes.

Depois da publicação, verifique `/api/health`, a tela de login e os dois perfis com os acessos atuais. Confira **Usage & billing** para manter o plano Free. Uma publicação de produção consome créditos: evite implantações repetidas sem necessidade e restrinja builds automáticos conforme o uso da equipe.

Para atualizar a instalação publicada, faça login pela CLI oficial, confira a versão do repositório e execute o deploy com build completo:

```powershell
npm exec --yes --package=netlify-cli -- netlify login
npm exec --yes --package=netlify-cli -- netlify deploy --prod --context production --site 81dd602d-aaa7-47eb-a5f4-5e75eaef457a
```

O comando usa `netlify.toml` para publicar `public` e empacotar as funções de `netlify/functions`. Não use `.netlify/functions` como diretório de origem no upload: essa pasta é o cache gerado pelo build. Verifique que `/api/health` responde JSON com status 200 e que `/api/me` responde 401 sem sessão. Mantenha previews privados e as credenciais somente em produção.

## Backup e migração local

Preserve exportações privadas do Supabase e teste a recuperação. A chave fotográfica deve ser recuperável separadamente. A exclusão de uma foto na aplicação não elimina cópias de backups anteriores, cuja retenção segue a política operacional. `npm run backup` é exclusivo do SQLite local e recusa o modo Supabase.

Para importar uma instalação local nova, pare o servidor durante a transferência, preserve a chave original e execute `node --env-file=.env.supabase scripts/migrate-supabase.mjs`. O script faz backup e exige o destino vazio. Transfere os cadastros, hashes de senha e demais dados em uma transação; recusa demonstrações e nunca sobrescreve um destino preenchido. Sessões não são transferidas; entre novamente. O SQLite original é preservado.

Referências: [Netlify Free e cotas](https://www.netlify.com/pricing/), [planos baseados em créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [funções Netlify](https://docs.netlify.com/build/functions/configuration/), [pooler Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) e [Supabase Free](https://supabase.com/pricing).
