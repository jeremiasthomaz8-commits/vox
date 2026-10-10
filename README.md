# Vox — Inteligência em Saúde

Aplicação funcional para avaliar o atendimento de UBS e apoiar a gestão da Secretaria Municipal de Saúde de Louveira. Toda a interface é em português do Brasil, com datas e horários de São Paulo.

O repositório contém apenas o código, as fontes e a documentação. Banco de dados, fotografias, backups e configurações com credenciais ficam fora do Git. Ao clonar, siga a instalação abaixo para provisionar um banco novo.

## Executar

Requisito: **Node.js 24 ou superior**. Não há dependências de execução para instalar, serviços externos ou chaves de API.

```powershell
npm start
```

Abra **http://127.0.0.1:3000**. O banco local de desenvolvimento já foi provisionado com os dois acessos solicitados:

| Perfil | Usuário | Ambiente |
| --- | --- | --- |
| Direção | `admregulacaodiretor` | Painéis administrativos |
| UBS Monterrey | `UBSMonterrey` | Totem exclusivo da unidade |

As senhas iniciais são as fornecidas no pedido. Elas não estão no código, no JavaScript do navegador ou nesta documentação. O banco armazena somente hashes scrypt com salt. A interface permite alterá-las; em produção a troca é obrigatória antes do acesso aos dados.

As 2.600 avaliações de teste e os cinco alertas de demonstração foram removidos a pedido do usuário, com backup prévio. Os acessos e cadastros de unidades foram preservados. Os cadastros ilustrativos não constituem uma relação oficial da rede municipal. Crie os acessos adicionais pela direção.

### Instalação em outro computador

```powershell
git clone https://github.com/jeremiasthomaz8-commits/vox.git
cd vox
Copy-Item .env.example .env
npm run setup
npm start
```

O setup pergunta os usuários e as senhas sem mostrar as senhas digitadas. Use `node scripts/setup.mjs --demo` se desejar também os registros fictícios. Sem `--demo`, o banco começa com as seis categorias, a UBS Monterrey e os dois acessos, sem avaliações. O setup é explícito e não recria contas existentes.

## O que funciona

- Autenticação com sessões no servidor, cookies HttpOnly, proteção CSRF, limite de tentativas e separação de perfis em todas as APIs.
- Totem de seis perguntas, notas de 1 a 5, navegação com respostas preservadas, revisão, confirmação e reinício após 7 segundos. Abandono reinicia após 120 segundos, com aviso aos 90 segundos.
- Envio transacional, unidade determinada pelo usuário autenticado e idempotência para repetição de envios. Falhas não produzem uma confirmação falsa de recebimento.
- Dashboard com scores, satisfação, contagem de avaliações, ranking, prioridades, evolução temporal, categorias e volume. Todos usam SQLite e filtros de período e unidade.
- Cadastro e edição de UBS, CNES e endereço, ativação, identificador de dispositivo, criação de acesso e redefinição de senha.
- Análise de unidade, comparação com a média municipal, evolução de cada categoria, registros recentes e prioridades calculadas por regras explícitas.
- Comparação de duas ou mais unidades, com os seis critérios e tamanho da amostra.
- Alertas configuráveis para scores baixos, quedas, volume, notas máximas, respostas idênticas, concentração, falhas técnicas e reenvios. Revisões mantêm status, observações e histórico.
- Auditoria sem edição ou exclusão pela aplicação e exportação de relatórios CSV e PDF.
- Layout responsivo, foco visível, controles identificados e totem com grandes alvos de toque. Fonte Sora local em toda a interface, gráficos e relatórios PDF.

### Fotografias

Ativas localmente por `PHOTO_CAPTURE_ENABLED=true`. No fim da avaliação, o paciente escolhe **AUTORIZAR FOTO** ou **CONTINUAR SEM FOTO**. Após autorizar, o navegador solicita acesso à câmera; o paciente confere a prévia, toca em **TIRAR FOTO** e pode refazer ou remover a imagem antes do envio. Recusa, câmera indisponível e permissão negada não impedem o envio das notas. Não há captura em segundo plano nem reconhecimento facial.

No acesso do diretor, abra **Fotografias**, filtre por período, unidade ou status e toque em **Ver foto**. Os detalhes da avaliação também permitem abrir a foto. Cada leitura exige sessão de diretor e gera auditoria. As imagens são criptografadas com AES-256-GCM em uma tabela privada do banco. O diretor pode excluir a foto preservando as notas. Relatórios não incluem fotografias.

A retenção padrão é de 30 dias, configurável. O servidor exclui fotos vencidas ao iniciar, a cada dez minutos e antes de consultas. Veja [operação](docs/operations.md) para permissões, proteção de chaves, backups e produção.

## Verificar

```powershell
npm run check
npm test
npm run backup
```

Os 23 testes de integração usam bancos temporários em memória e também cobrem consentimento, criptografia, acesso protegido e retenção de fotos. Cobrem autorização, CSRF, persistência, idempotência, cálculo, filtros, transações, alertas, auditoria, exportações, senhas e bloqueio por tentativas.

Os testes visuais opcionais `node tests/ui-smoke.mjs` e `node tests/ui-photos.mjs` precisam de Playwright e Chrome. Defina `PLAYWRIGHT_MODULE` e `CHROME_PATH` para outras instalações. Ambos iniciam servidores próprios e bancos em memória, sem acessar o banco de uso. O teste fotográfico usa câmera simulada e não aciona a webcam real. As imagens de revisão ficam em `output/qa/`, sem inclusão no controle de versão.

## Estrutura

| Diretório | Responsabilidade |
| --- | --- |
| `public/` | Interface modular sem dependências, CSS e ícones SVG |
| `server/index.mjs` | HTTP, validação, autenticação de rotas e operações |
| `server/auth.mjs` | scrypt, sessões, bloqueio de tentativas e cookies |
| `server/analytics.mjs` | Agregações, scoring, períodos e fuso horário |
| `server/alerts.mjs` | Regras de detecção explicáveis |
| `server/reports.mjs` | Exportações autorizadas CSV/PDF |
| `server/photos.mjs` | Consentimento, criptografia, chave privada e retenção de fotos |
| `migrations/` | Esquema relacional, índices e restrições |
| `scripts/` | Provisionamento, verificação e backup |
| `tests/` | Testes de integração e navegação |
| `data/` | SQLite e backups locais, ignorados pelo Git |

O stack usa os módulos nativos do Node.js e SQLite, adequado a um MVP de processo único. A interface usa módulos JavaScript e componentes de renderização reutilizáveis; não depende de React nem de conexão externa para carregar. Para operação distribuída ou escala maior, migre o adaptador de persistência para PostgreSQL mantendo as regras no servidor. Veja [arquitetura e segurança](docs/architecture.md).

## Produção

Esta entrega é um **ambiente local de desenvolvimento**. Não foi publicada para pacientes. A especificação exige revisão municipal antes da implantação. Aprovação jurídica e de proteção de dados, configuração de TLS, ambiente de banco limpo, backups fora da máquina, proteção do disco, rotação das credenciais e operação dos totens são etapas de implantação, documentadas em [docs/operations.md](docs/operations.md). Controles técnicos não equivalem a uma declaração automática de conformidade com a LGPD.
