# Assistente de Medicação 1.0 — configuração no Xcode

## Identificadores preparados no projeto
- iPhone: `br.com.mmregistro.assistentemedicacao`
- Watch: `br.com.mmregistro.assistentemedicacao.watchkitapp`
- Complication: `br.com.mmregistro.assistentemedicacao.watchkitapp.complications`
- App Group Watch/Complication: `group.br.com.mmregistro.assistentemedicacao.watch`
- Marketing Version: `1.0.0`
- Build: `1`

## Primeira abertura
1. Execute o `mm-update` do projeto e depois `mm-check assistente && mm-open assistente`.
2. No Xcode, selecione o projeto **App**.
3. Em **Signing & Capabilities**, configure o mesmo Team da conta Apple Developer nos três targets:
   - App
   - Assistente Watch Watch App
   - Assistente Watch Complications
4. Mantenha **Automatically manage signing** habilitado.

## App Group obrigatório para a complication
Nos targets **Assistente Watch Watch App** e **Assistente Watch Complications**:
1. Signing & Capabilities → `+ Capability` → **App Groups**.
2. Marque/crie exatamente: `group.br.com.mmregistro.assistentemedicacao.watch`.
3. O mesmo App Group deve estar presente nos dois targets.

Os arquivos de entitlements já estão no projeto; o passo acima registra/autoriza o grupo na conta Apple Developer e nos profiles.

## Notificações
O Assistente usa notificações locais do iPhone (`UNUserNotificationCenter`), sem Worker/APNs próprios. Não é necessário habilitar Push Notifications para esta arquitetura.

## Primeiro teste
1. Conecte o iPhone com o Apple Watch pareado.
2. Selecione o scheme do App e rode no iPhone.
3. Aceite a permissão de notificações quando criar/ativar um agendamento.
4. Crie um agendamento curto de teste e confirme:
   - registro manual/eventual continua funcionando;
   - registro do Watch chega ao iPhone;
   - complication mostra doses tomadas/previstas e countdown da próxima dose;
   - alteração do agendamento muda somente a vigência futura.

## Archive
Antes do primeiro TestFlight/App Store:
1. Confirme os três Bundle IDs na conta Apple Developer/App Store Connect.
2. Confirme que o App Group está habilitado nos targets Watch e Complication.
3. `Product` → `Archive`.
4. `Validate App` antes de `Distribute App`.
