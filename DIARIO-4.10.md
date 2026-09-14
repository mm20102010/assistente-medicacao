# Diário de Medicação 4.10

## Ordem de bootstrap Watch → iPhone

A 4.10 fecha a janela de startup identificada na revisão manual sem alterar o protocolo de sincronização:

1. `openDatabase()`;
2. `loadState()`;
3. `bindNativeWatchEventRecovery()`;
4. primeiro `syncWatchMedicationEventsFromNative({ render:false })`;
5. `renderAll()`.

Com isso:

- evento anterior ao listener permanece protegido pela fila nativa e é encontrado pelo drain inicial;
- evento posterior ao listener dispara o drain imediatamente;
- evento durante drain usa `watchEventSyncRequested` e força nova passagem;
- IndexedDB + readback continuam sendo condição para ACK;
- nenhuma mudança foi feita em UUID, deduplicação, cutoff/reset, epoch/revision, transportes ou complication.

O utilitário de versão foi alinhado ao novo padrão: Marketing Version/UI **4.10**, pacote npm **4.10.0**.

MM Registro Core permanece 4.0.0.
