// Handler serverless do Vercel. Importa o build compilado (dist/), não o
// TypeScript fonte — assim os aliases "@/..." já reescritos pelo tsc-alias
// resolvem normalmente, sem depender de como o builder trata paths.
//
// timezone.js precisa vir primeiro: fixa process.env.TZ antes de qualquer
// outro módulo fazer conta de data.
import "../dist/src/lib/timezone.js";
import { createApp } from "../dist/src/app.js";

export default createApp();
