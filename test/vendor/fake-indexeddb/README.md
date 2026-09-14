# fake-indexeddb 6.2.5 — somente testes

Cópia integral e sem alterações de `build/esm/` do pacote npm
`fake-indexeddb@6.2.5`, com a licença Apache-2.0 original em `LICENSE`.
Origem: https://github.com/dumbmatter/fakeIndexedDB

Incluída localmente para que o gate executado por `mm-update` funcione sem
instalar novas dependências. Não é importada pelo código de produção.
Ao atualizar, substituir o diretório ESM completo, preservar a licença e
executar `npm run repo:gate` em uma extração sem `node_modules`.
