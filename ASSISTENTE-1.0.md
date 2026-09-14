# Assistente de Medicação 1.0

Derivado do Diário de Medicação.

- Registros manuais/eventuais preservados.
- Agendamentos recorrentes editáveis por vigência.
- Quarta aba Agendamentos.
- Lembretes locais com iPhone master, sem Worker.
- Apple Watch mantém fila durável de registros.
- Complication mostra progresso diário e próxima dose.
- Análises separam eventuais e adesão/pontualidade dos agendados.

## Associação entre registro e agendamento

- Registro no horário ou atrasado dentro da janela de associação é baixado automaticamente.
- Dose futura a até 1 minuto do registro é baixada automaticamente.
- Se a próxima dose do mesmo remédio estiver mais de 1 minuto no futuro, o usuário confirma se o registro corresponde àquela dose; se negar, o registro permanece eventual.
- `scheduleId` e `scheduledAt` fazem parte do registro persistido e sobrevivem a relaunch, backup e restore.
- Ao baixar uma dose, notificações locais, status da aba Agendamentos e projeção do Watch/complication são reconciliados.
