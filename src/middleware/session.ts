// Perfil único: a sessão guarda só quem é o usuário, sem role. O controle
// de quem fez o quê vive no AuditLog — ver PLANO.md.
export interface SessionUser {
  id: number;
  name: string;
  email: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export {};
