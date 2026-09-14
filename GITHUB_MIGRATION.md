# Migração segura do Diário para GitHub + Capacitor

Este pacote foi construído sobre o ZIP atual do repositório `diario`, preservando os três workflows existentes e o mecanismo `updates/*.zip`.

## Antes de substituir o GitHub

1. Mantenha a pasta B2.1 validada no iPad.
2. Nesta pasta B3, adote o `ios/` e o `package-lock.json` da B2.1:

```bash
npm run repo:adopt-ios -- "../Diario_Medicacao_2.47_Capacitor_B2.1"
```

3. Atualize dependências e sincronize:

```bash
npm install
npm run native:sync
```

4. Abra no Xcode e faça um smoke test no iPad:

```bash
npm run native:open
```

5. Rode o gate completo:

```bash
npm run repo:gate
```

6. Gere também o ZIP web e inspecione a saída:

```bash
npm run web:package
```

## O que o GitHub passa a conter

- `public/`: PWA e frontend compartilhado.
- `ios/`: projeto Xcode real, incluindo Signing configurável localmente.
- `native-assets/`, scripts Capacitor e testes.
- workflows GitHub atuais.

## O que continua igual no deploy web

O workflow `apply-zip-update.yml` continua aceitando o ZIP enviado para `updates/`, mas sincroniza somente `public/`. Portanto um ZIP web nunca apaga ou sobrescreve `ios/`, `native-assets/`, testes, scripts nativos ou workflows.

O workflow `deploy.yml` continua publicando somente `public/` no Cloudflare Pages.

## Regra

Não apagar a pasta B2.1 local nem alterar o repositório remoto até o B3 passar no iPad e em `npm run repo:gate`.
