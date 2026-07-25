import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { env, isProduction } from "@/config/env.js";
import { errorHandler, notFoundHandler } from "@/middleware/errorHandler.js";
import "@/middleware/session.js";
import "@/middleware/rawBody.js";

import { authRouter } from "@/modules/auth/auth.routes.js";
import { catalogRouter } from "@/modules/catalog/catalog.routes.js";
import { agendasRouter } from "@/modules/agendas/agendas.routes.js";
import { listsRouter } from "@/modules/lists/lists.routes.js";
import { appointmentsRouter } from "@/modules/appointments/appointments.routes.js";
import { queueRouter } from "@/modules/queue/queue.routes.js";
import { whatsappRouter } from "@/modules/whatsapp/whatsapp.routes.js";
import { closingsRouter } from "@/modules/closings/closings.routes.js";
import { indicatorsRouter } from "@/modules/indicators/indicators.routes.js";
import { teamRouter } from "@/modules/team/team.routes.js";
import { suggestionsRouter } from "@/modules/suggestions/suggestions.routes.js";
import { processQueue } from "@/modules/queue/queue.service.js";
import { closeExpiredAppointments } from "@/modules/whatsapp/whatsapp.service.js";
import { enqueueReminders, enqueueRetries, purgeExpiredData } from "@/modules/queue/cadence.service.js";
import { sendDailySummary } from "@/modules/reports/daily-summary.service.js";

const PgSession = connectPgSimple(session);

// O build do Vite sai em dist-web/ (ver vite.config.ts). process.cwd() em vez
// de __dirname porque a profundidade muda entre dev (tsx sobre src/) e build
// (dist/src/), mas o processo sempre roda a partir da raiz do projeto.
const WEB_DIST = path.join(process.cwd(), "dist-web");

export function createApp() {
  const app = express();

  // O Vercel termina TLS na borda e a função recebe HTTP puro. Sem confiar no
  // proxy, req.secure fica false e o cookie de sessão com secure:true é
  // descartado silenciosamente — o login responde 200 mas nenhum Set-Cookie
  // chega ao navegador.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // O frontend é React compilado pelo Vite: nada de script inline,
          // então não precisa de 'unsafe-inline' em scriptSrc.
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          // O PDF da lista é exibido em <iframe> na revisão, servido pela
          // própria origem.
          frameSrc: ["'self'", "blob:"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
    })
  );

  // Guarda o corpo bruto em req.rawBody: o webhook da Meta assina o payload
  // cru, e o JSON reserializado não bate com a assinatura.
  app.use(
    express.json({
      // Upload chega em base64 dentro do JSON, então o limite acompanha o
      // teto de 20 MB do arquivo com folga pra codificação.
      limit: "30mb",
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    })
  );

  app.use(
    session({
      // Usa DATABASE_URL (pooler em modo transaction), não DIRECT_URL: o
      // pooler em modo session tem teto baixo de conexões reais e cada
      // instância serverless abre a sua, esgotando o limite rapidamente.
      // connect-pg-simple só faz queries parametrizadas simples, então é
      // seguro no modo transaction.
      store: new PgSession({
        conString: env.DATABASE_URL,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: false, // timer de fundo não faz sentido em serverless
        errorLog: (err) => console.error("[SESSION STORE ERROR]", err),
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8, // 8h
        secure: isProduction,
        sameSite: "lax",
      },
    })
  );

  /* ---------------- API ---------------- */

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  /*
    Cron do Vercel (ver vercel.json). O Vercel manda
    "Authorization: Bearer <CRON_SECRET>" automaticamente quando a variável
    está configurada no projeto.
  */
  app.post(
    "/api/cron/queue",
    async (req, res, next) => {
      try {
        if (env.CRON_SECRET && req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
          return res.status(401).json({ error: "unauthorized" });
        }
        // Ordem importa: primeiro cria os jobs do dia (lembrete e reenvio),
        // depois processa a fila — assim o que foi enfileirado agora já sai
        // nesta mesma rodada, se couber no limite.
        const reminders = await enqueueReminders();
        const retries = await enqueueRetries();
        const processed = await processQueue();
        const closed = await closeExpiredAppointments();
        const purged = await purgeExpiredData();
        res.json({
          ...processed,
          remindersQueued: reminders.queued,
          retriesQueued: retries.queued,
          closedAsNoAnswer: closed,
          purged,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /*
    Resumo do dia pro gestor — cron próprio, uma vez por dia (18h de
    Brasília), separado do cron horário da fila. Ver vercel.json.
  */
  app.post(
    "/api/cron/daily-summary",
    async (req, res, next) => {
      try {
        if (env.CRON_SECRET && req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
          return res.status(401).json({ error: "unauthorized" });
        }
        res.json(await sendDailySummary());
      } catch (err) {
        next(err);
      }
    }
  );

  app.use(authRouter);
  app.use(catalogRouter);
  app.use(agendasRouter);
  app.use(listsRouter);
  app.use(appointmentsRouter);
  app.use(queueRouter);
  app.use(whatsappRouter);
  app.use(closingsRouter);
  app.use(indicatorsRouter);
  app.use(teamRouter);
  app.use(suggestionsRouter);

  app.use("/api", notFoundHandler);

  /* ---------------- Frontend (SPA) ---------------- */

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // Fallback do React Router: qualquer rota que não seja /api cai no
    // index.html pra o roteamento acontecer no cliente.
    app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
  }

  app.use(errorHandler);

  return app;
}
