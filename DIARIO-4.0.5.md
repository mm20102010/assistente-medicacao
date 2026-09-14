# Diário de Medicação 4.0.5

## Objetivo

Eliminar a permanência artificial em “Na fila” quando o iPhone já recebeu um registro do Apple Watch enquanto a WebView ainda está executando em background.

## Alteração

O callback nativo `mm:watch-medication-event-available` agora dispara o drain imediatamente independentemente de `document.hidden`, seguindo o mesmo padrão do Dentes. Eventos de `focus` e `visibilitychange` continuam como fallback de recuperação.

O contrato de durabilidade não mudou: o ACK definitivo só ocorre após persistência e readback do registro no IndexedDB.

## Não alterado

- WatchConnectivity nativo;
- formato dos registros;
- deduplicação por UUID;
- epoch/revision;
- reset/cutoff;
- importação/exportação;
- MM Registro Core 4.0.0;
- complication;
- lista/idioma iPhone → Watch.

## Regressão adicional

Há teste executável para WebView `hidden` e para burst em que um segundo evento chega durante um drain já em voo.
