# Diário de Medicação 4.0.3

Release incremental sobre 4.0.2.

## Alteração funcional

- adiciona uma complication estática de ícone ao Apple Watch;
- o glifo vetorial reproduz a marca central do app (o “M” formado por cápsulas) sem o fundo quadrado opaco do AppIcon;
- suporta `accessoryCircular`, `accessoryCorner` e `accessoryInline`;
- nome, descrição, texto inline e acessibilidade estão localizados em português, inglês e espanhol;
- ao toque, a complication funciona como atalho para o app do Watch.

## Isolamento

A complication não usa `WatchConnectivity`, `UserDefaults`, App Group, rede, IndexedDB, scheduler ou qualquer estado do Diário. A timeline é estática (`.never`). Portanto nenhuma nova rota de sincronização foi criada.

## Baseline

Todos os hardenings e funcionalidades da 4.0.2 permanecem inalterados. MM Registro Core permanece 4.0.0 e não foi modificado.
