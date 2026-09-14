# Assistente de Medicação — MM Registro

Repositório unificado do **Assistente de Medicação 4.10**, contendo o PWA publicado no Cloudflare Pages e a camada Capacitor para iOS.

## Assistente 4.10 — fecha a janela de startup Watch → iPhone

A 4.10 mantém todo o protocolo WatchConnectivity e a persistência já validados, alterando somente a ordem de bootstrap: após abrir o IndexedDB e carregar o estado, o listener `mm:watch-medication-event-available` é instalado **antes** do primeiro drain nativo. Assim, um evento que chega entre o snapshot inicial da fila e o fim do startup não precisa esperar `focus`, `visibilitychange` ou outro evento para ser processado. O coalescing existente continua garantindo nova passagem quando um evento chega durante um drain.

A versão visível/Marketing Version passa a ser **4.10**; o pacote npm usa **4.10.0** por exigência de SemVer. O MM Registro Core permanece em 4.0.0.

## Assistente 4.0.8 — equalização de hardening e gate nativo

O estado `Enviando…` do Apple Watch fica limitado a 1,5 s. Se o `sendMessage` interativo não entregar callback nesse intervalo, o mesmo UUID é colocado no transporte durável e a UI passa para `Na fila`. ACK, reply, erro e `didFinish` podem chegar em qualquer ordem sem regredir um sucesso já confirmado. A persistência continua condicionada ao IndexedDB + readback no iPhone.

## Assistente 4.0.6 — ACK imediato do Watch em WebView ativa no background

Alinha o registro Watch → iPhone ao padrão já usado pelo Dentes: quando o callback nativo informa um novo registro, a fila é drenada imediatamente mesmo se a WebView estiver `hidden`. `focus` e `visibilitychange` continuam como mecanismos de recuperação caso o iOS tenha suspendido a WebView. A persistência no IndexedDB + readback permanece obrigatória antes do ACK definitivo ao Watch.

## Assistente 4.0.2 — paridade de hardening com o Primary

A 4.0.2 fecha a auditoria explícita dos hardenings do Primary aplicáveis ao Assistente. O estado iPhone → Watch (lista, idioma, textos e cutoff) passa a carregar `stateSourceID` + `stateRevision`; o Watch aposenta epochs anteriores para impedir que um snapshot atrasado de uma instalação antiga recupere autoridade. Operações destrutivas/substituição agora esperam também a fila iPhone → Watch antes do cutoff e antes de concluir.

A infraestrutura de release também foi endurecida: ZIPs do workflow passam a ser completos, symlinks/segredos/artefatos gerados são rejeitados, o deploy executa o gate completo, e o repositório ganha validadores permanentes de release e estrutura nativa. O MM Registro Core permanece 4.0.0 byte a byte.

## Assistente 4.0.1 — hardening de sincronização e diagnóstico

A 4.0.1 fortalece o caminho Apple Watch → iPhone sem alterar o MM Registro Core. O Watch mantém o evento local até receber confirmação fim-a-fim de que o registro foi realmente persistido no IndexedDB; `transferUserInfo` concluído passa a significar apenas “na fila”. As gravações do estado inteiro no IndexedDB são serializadas para impedir lost updates entre um registro local e a drenagem do Watch. Limpeza/substituição usam cutoff de sincronização, exclusão individual consome UUIDs Watch conhecidos antes da remoção, transferências imediatas duplicadas são coalescidas e lista/idioma iPhone→Watch são enviados em ordem.

O Suporte agora oferece **Modo diagnóstico** opt-in, desligado por padrão. Quando ligado, o backup inclui snapshot e trace técnico limitado para investigar sincronização; ao desligar, o trace local é removido. O padrão reutilizável foi promovido ao Starter 4.0.1 como infraestrutura app-local, permanecendo fora dos quatro arquivos canônicos do Core 4.0.0.

## MM Registro Core 4.0

Esta versão incorpora o MM Registro Core 4.0. A edição de registro passa a usar a Secondary Sheet canônica, acima de todo o chrome e com altura útil total; ações destrutivas globais usam a nova zona de segurança `mm-destructive-zone`. A paridade visual entre Histórico e prévia de imagem e a validação compartilhada de intervalos **De/Até** permanecem ativas.

## MM Registro 4.0 — baseline consolidada

A versão 4.0 preserva a preparação de distribuição sem alterar as regras funcionais já validadas: iPhone-only na primeira publicação, watchOS mínimo 10.0, versão nativa alinhada, Privacy Manifests para iPhone/Watch, remoção da capability legada `armv7`, páginas de Privacidade/Suporte e sincronização do idioma escolhido no Assistente com todos os textos nativos do Apple Watch. A Política de Privacidade abre em Secondary Sheet interna e o Suporte usa o endereço developer.apps.mm@outlook.com.

## Princípio de migração

O WebApp permanece plenamente funcional e publicável durante toda a migração nativa. Ele só poderá ser desativado depois que a versão nativa estiver totalmente operacional, publicada na App Store e validada em produção.

## Estrutura

- `public/`: fonte única do frontend HTML/CSS/JS. É publicada no Cloudflare Pages e também empacotada pelo Capacitor.
- `ios/`: projeto Xcode versionado, incluindo o app iOS e o target watchOS do Assistente.
- `native-assets/`: assets específicos do app nativo, incluindo AppIcon iOS.
- `test/`: testes do projeto compartilhado/native layer.
- `scripts/validate-pwa.mjs`: gate histórico do PWA antes do deploy.
- `scripts/`: build/sync Capacitor, empacotamento web e validações de repositório.
- `.github/workflows/deploy.yml`: valida e publica alterações web na `main`.
- `.github/workflows/apply-zip-update.yml`: mantém o fluxo semi-automatizado de ZIP em `updates/`, atualizando **somente `public/`**.
- `.github/workflows/restore-stable.yml`: restauração da versão web Stable existente.
- `updates/`: caixa de entrada temporária para ZIPs automáticos do WebApp.

## Deploy WebApp

O fluxo atual permanece preservado. O Cloudflare Pages publica somente `public/` no projeto `diario-medicacao`, usando `cloudflare/wrangler-action@v4` e Wrangler fixado em `4.114.0`.

Repository Secrets existentes:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Para gerar um ZIP exclusivamente web:

```bash
npm run web:package
```

O arquivo é criado em `dist/Diario_Medicacao_WEB_4.10.zip` e não contém `ios/`, dependências ou assets nativos.

## iOS / Capacitor

Preparação inicial em um Mac novo ou depois de atualizar o clone oficial:

```bash
npm install
npm run repo:gate
npm run native:sync
npm run native:open
```

`public/` continua sendo a fonte do frontend. `native:sync` gera `native-web/` e atualiza o bundle local usado pelo app iOS sem alterar o fluxo de publicação do PWA.

## Apple Watch

O target `Assistente Watch Watch App` é SwiftUI nativo. Na versão 3.4.1, a lista configurada no Assistente continua seguindo este fluxo:

```text
IndexedDB -> JavaScript -> plugin Capacitor local -> Swift iOS -> WatchConnectivity -> SwiftUI watchOS
```

O Swift não contém uma lista própria de medicamentos. O iPhone envia ao Watch a lista persistida pelo Assistente usando `updateApplicationContext`, e novas listas substituem o estado anterior.

A interface watchOS 3.4.1 usa a paleta escura do Assistente, botões de medicamento mais altos e espaçados, título mais próximo da barra de status e confirmação flutuante ancorada mais abaixo para preservar o espaço útil da lista.

O Watch também pode registrar uma tomada. Cada toque cria um UUID próprio e captura o horário local do relógio e um timestamp ISO. Em Simulator, o envio imediato usa `sendMessage`; em dispositivos físicos, quando o iPhone não está alcançável, o evento pode ser colocado em `transferUserInfo`. O iPhone mantém uma fila nativa durável em `UserDefaults` até o JavaScript persistir o registro no IndexedDB e confirmar o UUID. A deduplicação por ID permite reenvio seguro sem criar duas tomadas no histórico. Quando o iPhone recebe um novo evento, o plugin Capacitor também emite um aviso imediato para o WebView drenar essa fila; inicialização, foco e retorno ao foreground continuam como recuperação de segurança.

```text
SwiftUI watchOS -> WatchConnectivity -> fila Swift iOS -> plugin Capacitor -> JavaScript -> IndexedDB
```

## Gates

```bash
npm test
npm run web:validate
npm run repo:check
npm run repo:check-full
```

`repo:check-full` exige `package-lock.json` e o projeto `ios/` real. Isso evita publicar no GitHub uma fonte nativa incompleta.


## Apple Watch complication

A 4.0.4 adiciona uma complication estática de ícone ao Watch. O target `Assistente Watch Complications` usa WidgetKit, é embutido no app do Watch e permanece somente leitura, sem criar uma segunda camada de sincronização.
