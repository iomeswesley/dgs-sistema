// Perfil único: a sessão guarda só quem é o usuário, sem role. O controle
// de quem fez o quê vive no AuditLog — ver PLANO.md.
//
// `activeClientId` — Fase 1 do PLANO-MULTICLIENTE.md: qual cliente as
// queries desta sessão enxergam (ver src/lib/tenant-context.ts). Hoje todo
// usuário só tem acesso a um cliente ("DGS"), então o login escolhe sozinho
// — o seletor de verdade, pra quando alguém tiver acesso a mais de um, é
// Fase 3 (interface). `isSuperAdmin` espelha `User.isSuperAdmin` na sessão
// pra não precisar consultar o banco de novo em toda requisição.
export interface SessionUser {
  id: number;
  name: string;
  email: string;
  activeClientId: number;
  isSuperAdmin: boolean;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export {};
