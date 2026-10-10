# Operação e implantação municipal

## Ambiente entregue

O Vox está configurado para desenvolvimento em `127.0.0.1:3000`, com SQLite em `data/vox.sqlite`. As avaliações de teste foram removidas com backup. Cadastros e acessos foram preservados. A fotografia opcional está ativa localmente. O servidor local não deve ser exposto diretamente à internet.

## Antes da implantação

Conforme a especificação recebida, a prefeitura deve aprovar formalmente a base legal, os avisos ao público, a minimização de dados, os perfis de acesso, os prazos de retenção, o atendimento aos direitos dos titulares e o procedimento de resposta a incidentes. A revisão se aplica à operação, mesmo sem fotos. A captura fotográfica implementada exige aprovação específica antes da implantação para pacientes.

Após a aprovação, o responsável técnico deve:

1. Preparar host e disco com criptografia e controle de acesso da conta de serviço. Usar um banco novo, sem a base de demonstração.
2. Configurar um proxy HTTPS confiável, certificado, cabeçalhos preservados e limite de tentativas no ingress. O proxy deve sobrescrever `X-Forwarded-Proto` e preservar o Host correspondente a `PUBLIC_ORIGIN`.
3. Provisionar as contas por `npm run setup`, com credenciais fortes fornecidas pelo responsável. Não usar `--demo`. Entregar as senhas por canal autorizado e exigir a troca no primeiro acesso.
4. Configurar `.env` sem versioná-lo:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
VOX_DB=data/vox-production.sqlite
LEGAL_REVIEW_APPROVED=true
TRUST_PROXY=true
PUBLIC_ORIGIN=https://ENDERECO-APROVADO-PELA-PREFEITURA
```

5. Iniciar `npm start` como serviço supervisionado pela equipe de infraestrutura. O processo recusa produção sem os parâmetros acima ou com avaliações fictícias. A flag de aprovação registra uma decisão externa; não substitui o documento de aprovação.
6. Verificar os dois perfis por HTTPS, acesso negado às APIs administrativas por usuário UBS, uma avaliação de ponta a ponta e exportação autorizada. Testar teclado, zoom, contraste, leitores de tela e os dispositivos de toque reais com os usuários do serviço.
7. Cadastrar as unidades oficiais e criar um acesso por unidade. Os cadastros de demonstração não são uma fonte oficial de nomes ou CNES.

O funcionamento em várias instâncias exige migração da persistência, sem compartilhar o arquivo SQLite em uma pasta de rede.

## Backups e recuperação

`npm run backup` executa `VACUUM INTO` e produz uma cópia consistente em `data/backups/`. Essa cópia local é uma ferramenta, não uma política completa de backup.

Defina com a infraestrutura a frequência, retenção, destino externo criptografado, alertas de falha e testes periódicos de restauração. Restrinja as permissões de banco, diretório, logs e backups à conta de serviço e aos administradores autorizados. Não envie o banco por e-mail nem o coloque em armazenamento público. Em produção, prefira disco local gerenciado fora de pastas de sincronização de arquivos.

Para restaurar:

1. Pare o serviço Vox e confirme que não há processo usando o banco.
2. Preserve uma cópia do banco atual e seus arquivos WAL/SHM, se existirem, em local restrito.
3. Restaure o backup consistente para um **novo caminho**, verifique `PRAGMA integrity_check` e `PRAGMA foreign_key_check`, e aponte `VOX_DB` para esse caminho. Não misture o backup com WAL/SHM de outro banco.
4. Inicie em ambiente restrito, valide acesso, contagens e relatórios, e registre a operação antes de reabrir os totens.

## Totens

Use um perfil de navegador dedicado, bloqueio do sistema operacional e modo quiosque. Faça login com o usuário da unidade. O identificador do dispositivo é configurado no cadastro e gravado pelo servidor, sem confiar em um identificador enviado pelo navegador.

O totem usa notas grandes, palavras e faces, permite voltar e revisar, e limpa as respostas após sucesso. A sessão abandonada é reiniciada após dois minutos; respostas incompletas não são enviadas. Sem conexão, a tela informa a falha e permite repetir o envio com a mesma chave, sem duplicar avaliações. Não há fila permanente de respostas offline.

O botão discreto de equipe exige a senha da unidade para mostrar as opções de alteração de senha ou encerramento de sessão. O perfil continua sem acesso a resultados ou configurações administrativas.

O botão **Sair**, ao lado do nome da unidade no cabeçalho do totem, permite encerrar a sessão e voltar ao login. A equipe informa a senha da unidade para confirmar a saída. Cancelar ou informar uma senha incorreta mantém o acesso aberto.

## Retenção, incidentes e fotografia

A retenção de avaliações e da trilha de auditoria deve ser aprovada pela prefeitura. Não há exclusão automática de avaliações ou auditoria neste MVP: preservam-se os registros até haver uma política aprovada. Fotografias usam o prazo de Configurações (padrão 30 dias), limitado ao prazo mostrado na autorização do paciente. O servidor exclui imagens vencidas no início, a cada dez minutos e antes das consultas. Com o serviço parado, a rotina roda na próxima inicialização. A exclusão remove o conteúdo da tabela privada e preserva a avaliação, os estados e a auditoria. Não equivale a apagamento forense do disco, WAL ou backups anteriores.

### Câmera e acesso da direção

No totem, o paciente autoriza a foto, libera a câmera no navegador, confere o enquadramento e toca em TIRAR FOTO. O acesso à câmera é interrompido após captura, cancelamento, saída da tela, inatividade e ocultação da página. Não é solicitado microfone. Em outro dispositivo, use HTTPS: endereços HTTP da rede local não oferecem o contexto seguro exigido pelo navegador. No primeiro uso, verifique também as permissões de câmera do Windows e do navegador. Se o navegador incorporado bloquear câmera, abra no Chrome ou Edge. Recusa ou indisponibilidade permite enviar a avaliação sem foto.

No perfil do diretor, Fotografias apresenta metadados e o botão Ver foto; imagens não são carregadas automaticamente. Os filtros são período, unidade e status. Excluir fotografia pede confirmação e preserva as seis notas. Visualizações e exclusões ficam na auditoria. URLs de imagens exigem sessão de diretor a cada leitura e não são públicas nem armazenadas em cache.

### Criptografia e restauração

As imagens JPEG (até 256 KiB e 1280 × 1280) usam AES-256-GCM, IV aleatório e identificador da avaliação como dados autenticados. Em desenvolvimento no Windows, `data/private/photo-key.json` contém a chave protegida por DPAPI CurrentUser. Ela só pode ser aberta pela mesma conta do Windows. Copiar apenas o banco para outro computador não restaura a leitura das fotos. Defina uma política de recuperação de chaves antes da implantação; não apague nem recrie uma chave que protege fotos existentes.

Em produção, configure `PHOTO_CAPTURE_ENABLED=true`, `PHOTO_PRIVACY_APPROVED=true` e `PHOTO_ENCRYPTION_KEY` com 32 bytes aleatórios em base64, injetados por gerenciador de segredos, além dos requisitos gerais de produção. A chave fica fora do banco; não coloque seu valor em código, logs ou relatórios. A troca de chave sem recriptografia torna as imagens existentes ilegíveis. Não há rotação automática nesta versão.

Os backups podem conter imagens criptografadas anteriores à exclusão. Sua retenção, acesso e descarte devem acompanhar a política aprovada. `npm run backup` copia o banco, sem a chave DPAPI; restaure com acesso à chave original. Como a pasta atual fica no OneDrive, migre a operação para disco local gerenciado e configure um destino restrito para backups antes de usar dados de pacientes.

Documente responsáveis e procedimentos para contenção de incidente, revogação de sessões, preservação de evidências e comunicações exigidas pela revisão jurídica. Os logs técnicos do processo contêm códigos e caminhos de rotas, sem payloads, senhas ou tokens. Para produção, conecte supervisão de disponibilidade e um destino protegido de auditoria; essas integrações não estão simuladas no MVP.
