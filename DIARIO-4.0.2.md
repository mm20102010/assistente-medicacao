# Diário de Medicação 4.0.2

## Objetivo

Reauditar, contra a baseline atual do Primary, todos os hardenings aplicáveis ao Diário e fechar as lacunas ainda existentes sem importar regras específicas de Dentes.

## Hardening iPhone → Watch

- snapshots de lista de remédios, idioma, textos e cutoff passam a carregar `stateSourceID` + `stateRevision`;
- o `stateSourceID` identifica a instalação/epoch do iPhone e sobrevive a relaunch normal;
- o Watch mantém a última origem/revisão aplicada e uma lista limitada de origins aposentadas;
- uma revisão antiga da mesma origem é rejeitada;
- após aceitar uma nova instalação do iPhone, snapshots atrasados da instalação anterior não podem recuperar autoridade;
- snapshots legados sem origem deixam de ser aceitos depois que o Watch já reconheceu um epoch identificado.

## Reset/substituição

- `Apagar todos os dados` e importação por substituição aguardam também o writer serializado iPhone → Watch antes de estabelecer o cutoff;
- depois de persistir o novo estado, aguardam novamente a fila iPhone → Watch antes de liberar a operação;
- permanecem ativos os hardenings 4.0.1 de ACK fim-a-fim, cutoff, drain coalescido e serialização do IndexedDB.

## Infraestrutura/release

- novo `scripts/validate-release.mjs` para rejeitar symlinks, segredos, temporários e artefatos gerados;
- novo `scripts/native-validate.mjs` para validar versão, Capacitor, fallback `en`, watchOS 10, device families, Privacy Manifests e localizações;
- `repo:gate` passa a incluir testes, PWA, validação de repositório, `native:build` e validação nativa estática;
- workflow de deploy executa `npm ci` + gate completo antes do Cloudflare Pages;
- workflow de ZIP passa a exigir **repositório completo**, preserva `.github` e rejeita conteúdo inseguro antes da sincronização.

## Classificação dos hardenings do Primary

Aplicados: epoch/revision de estado, ACK fim-a-fim, readback, filas duráveis, reconstrução de transfers, serialização, reset/cutoff, writer barrier, deduplicação por UUID, diagnóstico, segurança de ZIP e gates permanentes.

Não aplicáveis: scheduler/follow-ups, pain-level identity, resumo diário/summary bridge, `cycleId` de notificação, tombstone por ciclo, guards de formulário multi-etapa e complications.

MM Registro Core: **4.0.0**, inalterado byte a byte.
