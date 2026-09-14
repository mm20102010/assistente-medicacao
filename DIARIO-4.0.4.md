# Diário de Medicação 4.0.4

Correção isolada de localização da complication do Apple Watch.

- `configurationDisplayName` e `description` agora usam `Text` com chaves literais do String Catalog.
- Testes impedem regressão para overload ambíguo e rejeitam `extractionState = stale`.
- Nenhuma alteração em sincronização, IndexedDB, ACK, reset/cutoff, diagnóstico ou MM Registro Core.
