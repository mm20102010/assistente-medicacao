> **B2.1:** correção de empacotamento: inclui os assets nativos iOS que faltaram no ZIP B2 original.

# Assistente de Medicação 2.47 — Capacitor B2

## Objetivo da B2

Unificar o projeto Web + Capacitor + iOS em uma estrutura segura para GitHub, sem interromper o deploy atual do PWA.

### Fonte oficial do frontend

A partir da B2, todos os arquivos do WebApp ficam em `public/`.

- `public/` → fonte do PWA e também fonte do app Capacitor.
- `native-web/` → gerado automaticamente; nunca editar nem versionar.
- `ios/` → projeto Xcode; deve ser versionado, exceto dados locais do Xcode ignorados pelo `.gitignore`.
- `dist/` → artefatos gerados; nunca versionar.

## Adotar o projeto iOS já validado da B1

Com B1 e B2 lado a lado:

```bash
npm run native:adopt-existing -- "../Diario_Medicacao_2.47_Capacitor_B1"
npm install
npm test
npm run repo:check
npm run native:sync
```

## Gerar ZIP somente do WebApp

```bash
npm run web:package
```

Será criado:

`dist/Diario_Medicacao_WEB_2.47.zip`

Esse ZIP contém apenas os arquivos do PWA (mais os testes web) e é o artefato a ser usado no fluxo existente Google Drive → GitHub → Cloudflare Pages enquanto a versão nativa não estiver publicada e validada na App Store.

## Abrir o projeto iOS

```bash
npm run native:open
```

## Regra de segurança

O PWA continua sendo produção. Alterações nativas não devem exigir mudanças no PWA. O WebApp só poderá ser desativado após a versão nativa estar totalmente operacional, publicada na App Store e validada em produção.

## Contrato de safe area — paridade WebApp x Capacitor

O frontend compartilhado já é responsável integralmente pelas safe areas com
`viewport-fit=cover` e `env(safe-area-inset-*)`.

Por isso, no iOS, `capacitor.config.ts` deve manter:

```ts
ios: {
  contentInset: 'never',
}
```

Não usar `contentInset: 'automatic'`: isso faz o `UIScrollView` do `WKWebView`
aplicar um segundo ajuste de inset além do CSS e cria divergências entre PWA e
Capacitor (topo mais baixo, sticky headers deslocados, sheets mais baixos e
altura útil menor). O mesmo contrato deve ser usado nos demais apps MM Registro
que compartilham essa arquitetura.

