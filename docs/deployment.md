# Acesso pela internet

O GitHub guarda o código. O Vox precisa também de um servidor Node.js e de um disco persistente, pois autenticação, avaliações e fotografias são processadas no servidor. GitHub Pages não executa esse servidor. Depois da implantação, todos os dispositivos usam o mesmo link HTTPS e compartilham o banco, com sessões de login independentes.

## Publicar na Render

[Publicar o Vox na Render](https://render.com/deploy?repo=https://github.com/jeremiasthomaz8-commits/vox)

O arquivo `render.yaml` prepara um serviço Node.js 24.21.0 com uma instância, certificado HTTPS, monitoramento em `/api/health` e disco de 1 GB montado em `/var/data`. O banco fica em `/var/data/vox.sqlite`. A Render disponibiliza o disco no início do processo; por isso o provisionamento ocorre no primeiro início, nunca durante o build.

**Há cobrança:** o plano `0.5c-512mb` custa US$ 7/mês e o disco de 1 GB custa US$ 0,25/mês, conforme a tabela consultada em 10/10/2026. A base é US$ 7,25/mês, sujeita a câmbio, tributos, uso excedente e outros recursos da conta. Revise os valores mostrados pela Render antes de criar o serviço. O plano gratuito não oferece o disco persistente necessário a esta configuração.

1. Abra o link, entre na Render e escolha a conta e o workspace responsáveis pelo Vox. Revise os recursos e a cobrança.
2. Preencha as variáveis solicitadas no painel, sem colocá-las no GitHub:

| Variável | Valor / finalidade |
| --- | --- |
| `VOX_ADMIN_PASSWORD` | Senha inicial privada da direção, com 10 a 128 caracteres |
| `VOX_UNIT_PASSWORD` | Senha inicial privada da UBS Monterrey, com 10 a 128 caracteres |
| `LEGAL_REVIEW_APPROVED` | `true` somente após a revisão municipal já exigida pela especificação |
| `PHOTO_PRIVACY_APPROVED` | `true` somente após aprovação específica da política fotográfica |

Os usuários iniciais são `admregulacaodiretor` e `UBSMonterrey`. A chave `PHOTO_ENCRYPTION_KEY` é gerada pela Render, com 32 bytes aleatórios em base64. Preserve essa chave no gerenciador de segredos: recriá-la torna as fotos existentes ilegíveis. Se as fotos ainda não forem aprovadas, altere `PHOTO_CAPTURE_ENABLED` para `false` antes do primeiro início; as notas funcionam sem câmera.

3. Confirme a criação após revisar as configurações. Aguarde o build e o status **Live**. O build verifica a sintaxe; o início aplica as migrações e cria os acessos apenas se o banco estiver vazio. Nenhuma avaliação de teste é adicionada. Reinícios e novas implantações preservam as contas, as senhas alteradas e as avaliações.
4. Copie a URL HTTPS mostrada no serviço (terminada em `.onrender.com`). Esse é o link para abrir em Chrome, Edge, Safari ou outro navegador no computador, tablet e celular. O endereço do repositório e `127.0.0.1` não são o link público do sistema.
5. Entre em cada perfil e altere a senha provisória. Cadastre as unidades oficiais pela direção. Valide uma avaliação completa e, com a política aprovada, a câmera nos dispositivos reais. O navegador continua exigindo sua própria permissão de câmera. Fotografias são opcionais para o paciente.

A implantação começa com **um banco novo**. O banco, as fotos, os backups e as credenciais locais não são enviados pelo repositório. Uma migração do banco local deve ser uma operação separada, com transferência privada e recuperação da chave original, conforme [operação](operations.md).

## Atualizações e domínio

O template desativa implantação automática. Depois de testar e enviar alterações ao GitHub, use **Manual Deploy → Deploy latest commit** no serviço. O disco permanece montado. Não troque para o plano gratuito nem remova o disco. Este SQLite funciona com uma única instância; não ative réplicas compartilhando o mesmo arquivo.

O servidor adota automaticamente `RENDER_EXTERNAL_URL` como origem HTTPS. Ao configurar um domínio próprio na Render, defina também `PUBLIC_ORIGIN=https://seu-dominio` e passe a acessar exclusivamente esse domínio. A validação de Host e a proteção de origem continuam ativas para login, páginas e APIs. A rota de saúde é pública e revela apenas o estado do serviço.

## Backup

Execute `npm run backup` no Shell do serviço. A cópia consistente será criada em `/var/data/backups`, junto ao banco persistente, ou no diretório definido por `VOX_BACKUP_DIR`. Copie-a para armazenamento externo privado conforme a política operacional: uma cópia no mesmo disco não protege contra a perda do disco. Preserve também a chave de criptografia em seu gerenciador de segredos e teste a restauração. Monitore o espaço livre, especialmente ao habilitar fotos e manter backups.

Referências: [Blueprints](https://render.com/docs/blueprint-spec), [discos persistentes](https://render.com/docs/disks), [variáveis do ambiente](https://render.com/docs/environment-variables), [preços](https://render.com/pricing) e [Deploy to Render](https://render.com/docs/deploy-to-render).
