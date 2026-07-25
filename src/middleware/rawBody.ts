// Corpo bruto da requisição, capturado pelo "verify" do express.json() em
// app.ts — o webhook da Meta assina o payload cru, não o JSON reserializado.
declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}

export {};
