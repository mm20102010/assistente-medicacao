# Diário de Medicação 4.0.7

## Watch — timeout do fast path

- `sendMessage` permanece como tentativa interativa rápida.
- Após 1,5 s sem callback, o mesmo UUID é garantido em `transferUserInfo`.
- A UI troca `Enviando…` por `Na fila`, evitando estado indefinido.
- ACK/reply/error tardios só atuam se o UUID continuar pendente.
- ACK antes ou depois do timeout converge para o mesmo registro, sem duplicação.

Nenhuma alteração em IndexedDB, formato dos registros, import/export, histórico, reset/cutoff, complication ou MM Registro Core.
