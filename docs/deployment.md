# Acesso pela internet com Supabase

O GitHub guarda o código. A Render executa o servidor Node.js com HTTPS e o Supabase guarda os dados compartilhados. Todos os dispositivos usam a URL HTTPS da aplicação, com sessões independentes. O banco e as fotografias criptografadas ficam no PostgreSQL; não é necessário disco persistente na Render.

## Preparar o projeto Supabase existente

1. Aplique `supabase/migrations/202610110001_vox.sql` no SQL Editor ou por migração autenticada. O script cria somente o schema privado `vox`; não altera `public`, `auth` ou outros schemas. Execute uma vez.
2. Aplique `supabase/vox-app-role.sql`. Configure uma senha aleatória para o usuário de banco `vox_app` por um canal privado. Guarde a conexão somente no servidor. Esse usuário não é a conta do diretor; é uma credencial de infraestrutura com permissões restritas.
3. No painel **Connect → Direct → Session pooler**, copie o host real do projeto. Use a porta 5432 e o usuário `vox_app.PROJECT_REF`. Não deduza o host apenas pela região. Exemplo sem segredo:

```dotenv
VOX_DATABASE=supabase
DATABASE_URL=postgresql://vox_app.PROJECT_REF:SENHA_PRIVADA@HOST_DO_SESSION_POOLER:5432/postgres
```

O driver `pg` verifica a cadeia TLS e o nome do servidor. O certificado público oficial em `supabase/certs/prod-ca-2021.crt` foi obtido do download indicado pelo painel Supabase, com SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`, válido até abril de 2031. `DATABASE_CA_CERT` permite substituir a CA por PEM, inclusive com separadores literais `\n`. Atualize a CA conforme orientação do provedor; não desative a verificação TLS.

As tabelas têm RLS. `anon`, `authenticated` e `PUBLIC` não têm acesso ao schema. O navegador conversa com a API autenticada do Vox; não recebe a conexão PostgreSQL. Não adicione `vox` aos schemas expostos pela Data API.

## Migrar o banco local

Pare o servidor local durante a transferência para evitar novos envios no banco antigo. Preserve a chave fotográfica original em `PHOTO_ENCRYPTION_KEY` caso existam imagens. Configure a conexão privada e execute:

```powershell
node --env-file=.env.supabase scripts/migrate-supabase.mjs
```

O script faz um backup consistente antes da importação e exige tabelas Vox vazias. Transfere unidades, contas com os mesmos hashes de senha, avaliações, respostas, fotos criptografadas, alertas, histórico, configurações e auditoria em uma transação. Confere contagens e recusa avaliações de demonstração. Sessões e tentativas de login não são transferidas; entre novamente. O SQLite original é preservado. O destino preenchido nunca é sobrescrito.

## Publicar o servidor na Render

[Publicar o Vox na Render](https://render.com/deploy?repo=https://github.com/jeremiasthomaz8-commits/vox)

O `render.yaml` configura Node.js 24, build `npm ci --omit=dev && npm run check`, início `npm start`, saúde `/api/health` e uma instância em Virginia, próxima ao Supabase deste projeto. O plano `0.5c-512mb` tem base de US$ 7/mês conforme a tabela consultada em 10/10/2026; não há cobrança de disco neste template. Os custos do Supabase seguem o plano do projeto existente. Revise os valores no painel do provedor.

Configure as variáveis privadas no painel da Render:

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` | Conexão privada do usuário `vox_app` pelo session pooler |
| `PHOTO_ENCRYPTION_KEY` | Chave original de 32 bytes em base64; preserve fora do banco |
| `LEGAL_REVIEW_APPROVED` | `true` após a revisão municipal |
| `PHOTO_PRIVACY_APPROVED` | `true` após a aprovação da política fotográfica |
| `VOX_ADMIN_PASSWORD`, `VOX_UNIT_PASSWORD` | Somente para provisionar um banco sem contas; desnecessárias após migração |

Não gere outra chave se já houver fotos. Chaves diferentes tornam imagens existentes ilegíveis. As aprovações para este projeto foram confirmadas pelo responsável; mantenha o registro municipal correspondente.

Após o estado **Live**, use a URL HTTPS `.onrender.com` em computadores, tablets ou celulares. O repositório e `127.0.0.1` não são o endereço público. Valide os perfis da direção e da unidade. O navegador exige sua própria permissão de câmera e fotografias permanecem opcionais para o paciente.

O modo `supabase` recusa iniciar sem conexão ou migração; nunca cria um SQLite de substituição. Reinícios usam o mesmo banco remoto. O template desativa implantação automática; após testes e push, use **Manual Deploy → Deploy latest commit**. Se utilizar o plano gratuito, considere as suspensões por inatividade e limites documentados pela Render e pelo Supabase antes da operação com pacientes.

## Verificação, recuperação e domínio

Execute `npm test` e `npm run test:postgres` antes das atualizações. Os testes PostgreSQL usam PGlite isolado com o papel restrito do servidor, sem avaliações fictícias no projeto real. Incluem transações, fotos, permissões, migração e reenvios simultâneos. Faça também a verificação da conexão TLS com o Supabase real.

Use backups/exportações privados do Supabase conforme o plano, com retenção definida e restauração testada. A chave das fotos deve ser recuperável separadamente. `npm run backup` é exclusivo do SQLite local e recusa o modo Supabase. A exclusão de uma foto no sistema não remove cópias anteriores dos backups; sua retenção segue a política operacional. Monitore capacidade do banco, especialmente o volume de imagens.

O servidor adota `RENDER_EXTERNAL_URL` como origem HTTPS. Para domínio próprio, defina `PUBLIC_ORIGIN=https://seu-dominio` e use esse domínio. A validação de Host, HTTPS e origem continua ativa.

Referências: [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement), [Blueprints Render](https://render.com/docs/blueprint-spec) e [preços Render](https://render.com/pricing).
