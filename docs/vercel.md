# Compatibilidade do Vox com a Vercel

O repositório inclui uma implantação nativa para Vercel Functions com Node.js 24 e o mesmo banco Supabase. A operação atual continua em [vox-louveira.netlify.app](https://vox-louveira.netlify.app/).

## Plano adequado ao uso

A Vercel restringe o plano Hobby gratuito a uso pessoal e não comercial. O responsável informou que o Vox será usado oficialmente pelas UBS e precisa permanecer sem custos. Por isso, a implantação operacional permanece na Netlify Free. A compatibilidade deste repositório permite uma futura publicação na Vercel quando houver plano ou autorização compatível com esse uso. Não há contratação de plano pago nesta alteração.

Consulte as [condições de uso da Vercel](https://vercel.com/docs/limits/fair-use-guidelines). Havendo dúvida de elegibilidade, a própria Vercel orienta consultar seu suporte.

## Configuração da implantação

Quando a hospedagem estiver autorizada:

1. Importe `jeremiasthomaz8-commits/vox`, branch `main`, na equipe Vercel adequada.
2. Use o framework **Other**, a raiz do repositório e Node.js **24.x**. O `vercel.json` define instalação `npm ci`, build `npm run check`, arquivos públicos em `public` e funções em `api`.
3. Defina o endereço principal HTTPS e configure as variáveis abaixo somente no ambiente **Production**. Mantenha previews protegidos; a API recusa conectar ao banco quando `VERCEL_ENV` indica preview ou desenvolvimento.
4. Faça o deploy de produção e verifique a página de login, `/api/health` e os perfis existentes.

| Variável | Valor/finalidade |
| --- | --- |
| `NODE_ENV` | `production` |
| `VOX_DATABASE` | `supabase` |
| `DATABASE_URL` | Conexão privada de `vox_app` no transaction pooler do projeto, porta 6543 |
| `PUBLIC_ORIGIN` | Origem HTTPS principal da Vercel, sem caminhos ou parâmetros |
| `TRUST_PROXY` | `true` |
| `LEGAL_REVIEW_APPROVED` | `true`, conforme aprovação municipal registrada |
| `PHOTO_CAPTURE_ENABLED` | `true`, para habilitar fotografias opcionais |
| `PHOTO_PRIVACY_APPROVED` | `true`, conforme aprovação da política fotográfica registrada |
| `PHOTO_ENCRYPTION_KEY` | A mesma chave original de 32 bytes em base64 |
| `CRON_SECRET` | Segredo aleatório exclusivo da manutenção, com pelo menos 32 caracteres |

Preserve a chave original das fotografias. Os dois endereços podem usar o mesmo banco e os mesmos cadastros, contas e avaliações. Cada navegador precisa entrar separadamente, pois os cookies de sessão pertencem ao domínio acessado.

`api/vox.mjs` usa a assinatura moderna `fetch(Request) → Response`. O adaptador mantém as verificações de Host/origem, HTTPS, CSRF, perfil de acesso, idempotência e limites de envio. O IP vem dos cabeçalhos fornecidos pela plataforma. A conexão com o Supabase verifica TLS e usa um pool pequeno apropriado a funções temporárias.

As fontes Sora dos PDFs e a CA pública do Supabase são incluídas no pacote das funções. `.vercelignore` e `excludeFiles` protegem arquivos locais de dados, credenciais, backups e saídas de testes. `public: false` no arquivo Vercel mantém código e logs de implantação privados; essa opção não substitui o login da aplicação.

## Retenção de fotos

`api/photo-retention.mjs` exige `Authorization: Bearer CRON_SECRET`. Chamadas sem segredo válido não acessam o banco. A Vercel envia esse cabeçalho automaticamente quando `CRON_SECRET` está configurado.

O agendamento do template é diário, `0 3 * * *` em UTC, respeitando o limite de frequência do Hobby para instalações pessoais elegíveis. A API também elimina fotos vencidas ao iniciar e antes de consultas. A remoção física em uma instalação Vercel isolada pode ocorrer na execução seguinte; a foto vencida é excluída antes de sua leitura pela API. Enquanto a instalação atual da Netlify estiver ativa, sua manutenção a cada dez minutos continua atuando no banco compartilhado.

## Verificação

```powershell
npm run check
npm test
npm run test:postgres
```

Os testes usam bancos isolados SQLite e PostgreSQL PGlite. Cobrem os adaptadores Netlify e Vercel, login/logout, cookies seguros, CSRF, isolamento de perfis, fotos criptografadas, bytes de PDF/JPEG, exportação CSV, idempotência, bloqueio de previews e manutenção autenticada. Não criam avaliações fictícias no Supabase em operação.

Após publicar, `/api/health` deve retornar JSON com status HTTP 200 e `/api/me` deve retornar 401 sem sessão. Fotos e relatórios exigem login de diretor. A tela deve carregar a fonte Sora e a câmera depende da permissão do navegador e da escolha do paciente.

Referências: [Node.js na Vercel](https://vercel.com/docs/functions/runtimes/node-js), [configuração Vercel](https://vercel.com/docs/project-configuration/vercel-json), [cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) e [proteção do agendamento](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
