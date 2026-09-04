-- Novo status: extração não achou horário (às vezes nem data) pra esse
-- paciente. Antes disso, o agendamento nascia com `scheduledAt = new Date()`
-- (o instante em que a lista foi processada) e status PENDENTE normal,
-- entrando na fila de envio com uma data/hora inventada, sem nenhum aviso
-- pro paciente de que aquilo não é a consulta real (achado em produção,
-- 2026-09-04 — mensagem real saiu com "04/09 09h06" pra uma consulta que
-- era só dia 10/09). A partir de agora esse caso vira SEM_DATA e nunca
-- entra na fila (só PENDENTE é elegível pro disparo).
ALTER TYPE "AppointmentStatus" ADD VALUE 'SEM_DATA';
