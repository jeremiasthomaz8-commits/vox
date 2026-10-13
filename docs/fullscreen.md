# Tela cheia

O botão **Tela cheia** fica no login, no cabeçalho do painel e no cabeçalho das unidades. Em celulares, aparece como um ícone com área de toque de 44 pixels. Toque novamente em **Sair da tela cheia** para voltar. No computador, a tecla Esc também encerra o modo nativo.

O recurso coloca o documento inteiro em tela cheia: navegação, modais e a prévia autorizada da câmera continuam disponíveis. Trocar de página, entrar ou sair da conta não substitui o elemento em tela cheia. O botão acompanha a saída pelo navegador, sem reentrar automaticamente ou alterar as respostas da avaliação.

Alguns navegadores móveis não permitem tela cheia para páginas. Nesse caso, o botão mostra instruções adequadas ao dispositivo. No iPhone/iPad, abra no Safari, escolha **Compartilhar → Adicionar à Tela de Início**, ative **Abrir como App Web** se essa opção aparecer e abra o novo ícone. No Android, use **Instalar aplicativo** ou **Adicionar à tela inicial** no menu do navegador.

O manifest e os ícones permitem abrir o Vox como aplicativo, sem a barra de endereços. Barras de status e gestos continuam sujeitos ao sistema do dispositivo. Isso não adiciona funcionamento offline: login, avaliações e relatórios continuam usando a API online, sem copiar respostas ou fotografias para um cache de aplicativo.

Os testes cobrem entrada/saída, saída externa pelo navegador, chamadas repetidas, rejeição de permissão, alternativa sem suporte, eventos do Safari antigo e os arquivos de instalação servidos pelo Node. A verificação visual usa contas de uma base local somente em memória. Compatibilidade em dispositivos físicos específicos deve ser conferida neles.

Referências: [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API/Guide), [manifest em modo standalone](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display) e [abrir um site como app no iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
