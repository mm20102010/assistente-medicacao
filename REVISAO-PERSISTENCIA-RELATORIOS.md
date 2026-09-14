# Revisão: persistência por registro e relatórios

O IndexedDB `diario_medicacao` passa à versão 2. `app_state/main` guarda metadados; `records` guarda cada registro pelo seu UUID, com índice de data. A primeira abertura migra o estado antigo e substitui o blob na mesma transação: em caso de aborto, o estado anterior permanece intacto. Nenhum Worker, servidor ou D1 é necessário.

As gravações permanecem serializadas. O histórico ainda é carregado em memória e os snapshots são comparados, mas somente registros alterados são escritos no banco. Não há mais normalização/ordenação de todo o histórico em cada save. Backup, importação e exportações continuam usando o histórico completo. O ACK do Watch consulta as chaves efetivamente persistidas.

Os cards da análise acomodam nomes longos, inclusive palavras sem espaços. O rodapé quebra linhas e a frase removida anteriormente não retorna. A quantidade de registros usa o idioma ativo.

## Verificação

`npm run repo:gate` executa as suítes, valida a PWA e verifica a sincronização nativa. O teste de transações usa a cópia local de `fake-indexeddb` 6.2.5 em `test/vendor/`, com licença preservada, sem exigir instalação adicional no fluxo `mm-update`. Essa biblioteca é exclusiva dos testes e não integra o app. O teste executa as funções reais do app com migração de 10.001 registros, aborto/retry, CRUD incremental e ACK condicionado ao commit.

`scripts/qa-browser.cjs` executa também IndexedDB e PNG em Chromium real. Requer Playwright instalado; `PLAYWRIGHT_MODULE` pode indicar o caminho absoluto do módulo, `CHROMIUM_EXECUTABLE` o navegador, e `QA_OUTPUT` o diretório de evidências. Sem esses overrides, usa `playwright` e seu navegador padrão.

Antes de atualizar dados reais, exporte o backup JSON. O formato de backup continua compatível, mas uma versão antiga do app que abre o IndexedDB na versão 1 não pode abrir diretamente o banco já migrado para a versão 2. Um eventual rollback exige procedimento de restauração a partir de backup; não basta instalar o código antigo.

O gate de shell nativo não substitui compilação no Xcode nem teste em dispositivos Apple.
