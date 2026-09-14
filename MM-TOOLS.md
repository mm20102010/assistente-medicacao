# Assistente de Medicação — MM Tools

Padrão atual do projeto MM - Códigos: `mm-update` recebe ZIP + mensagem e já executa aplicação, gates, commit/push/publicação; depois encadear `mm-check` e `mm-open` com `&&`.

## Atualização/publicação
```bash
mm-update assistente ~/Downloads/Assistente-de-Medicacao-1.0.zip "Assistente de Medicação 1.0 - versão inicial com agendamentos, lembretes locais e Watch" && mm-check assistente && mm-open assistente
```

## Primeiro cadastro
O alias `assistente` precisa existir na versão instalada do mm-tools antes dos comandos acima. Depois de cadastrado e de existir o repositório remoto correspondente, a inicialização do clone segue o fluxo do MM Tools:
```bash
mm-init-clone assistente
```

Não use o alias `starter` para publicar o Assistente; ele deve continuar sendo o projeto-base independente.
