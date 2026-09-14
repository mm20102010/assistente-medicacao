# Diário de Medicação 4.0.1

## Objetivo

Hardening do caminho Apple Watch → iPhone e inclusão de diagnóstico técnico opt-in, preservando integralmente o MM Registro Core 4.0.0.

## Sincronização Watch → iPhone

- ACK fim-a-fim: o Watch só remove definitivamente um registro depois da confirmação de persistência no IndexedDB.
- `transferUserInfo` concluído não é mais tratado como persistência final; enquanto a WebView do iPhone não incorporar o evento, o Watch mantém a cópia local e mostra estado de fila.
- Fila nativa iPhone e fila local Watch verificam persistência por readback antes de avançar.
- IDs reconhecidos aumentaram para 10.000 para reforçar deduplicação de retransmissões tardias.
- Relaunch do Watch reconstrói `outstandingUserInfoTransfers`, evitando tempestades de duplicatas.
- `sendMessage` imediato do mesmo UUID não pode ficar simultaneamente em voo mais de uma vez.

## Concorrência e estado

- Escritas do estado completo no IndexedDB são serializadas; um snapshot antigo não pode terminar depois e apagar um registro mais novo.
- Lista de medicamentos/idioma/textos iPhone → Watch são serializados no JavaScript e o snapshot nativo é protegido por fila própria.
- `Apagar todos os dados` e importação por substituição usam cutoff nativo para que eventos antigos do Watch não reapareçam após a operação.
- Exclusão individual consome um UUID Watch já conhecido antes de removê-lo do IndexedDB, evitando ressurreição por retransmissão ainda pendente.

## Diagnóstico

- Nova tela de Suporte com chave de **Modo diagnóstico**.
- Desligado por padrão.
- Trace local circular limitado a 500 eventos.
- O backup inclui `diagnostics` apenas enquanto o modo estiver ativo.
- Ao desativar, o trace local é removido.

## Arquitetura

O diagnóstico reutilizável pertence ao Starter como scaffold app-local. Ele não foi incorporado ao MM Registro Core porque snapshot, eventos e política de exportação variam por produto.

MM Registro Core: **4.0.0**, sem alterações.
