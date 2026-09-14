# Diário de Medicação 4.0.8

- `stateSourceID` fail-closed: estado autoritativo não é enviado com epoch não persistida.
- drain de eventos do Watch usa um único readback do IndexedDB por lote e confirma todos os UUIDs contra o mesmo snapshot persistido.
- `repo:gate` executa verificação real do native sync em sandbox temporário, comparando `public`, `native-web` e `ios/App/App/public` byte a byte sem sujar o clone.
- ZIP/deploy/restore passam por gate mínimo protegido em `.github`; restore web usa o gate web atual antes do commit.
- MM Registro Core permanece 4.0.0.
