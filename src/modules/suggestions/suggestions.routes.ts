import { Router } from "express";
import { asyncHandler } from "@/middleware/errorHandler.js";
import { requireAuth } from "@/middleware/auth.js";
import { routeId } from "@/lib/http.js";
import { suggestionForList } from "./suggestions.service.js";

export const suggestionsRouter = Router();
suggestionsRouter.use("/api/suggestions", requireAuth);

/**
 * Quantas confirmações buscar para fechar a agenda desta lista.
 *
 * Devolve `suggestion: null` quando não há capacidade cadastrada para o
 * médico — a tela então não mostra nada, em vez de exibir um alvo inventado.
 */
suggestionsRouter.get(
  "/api/suggestions/list/:id",
  asyncHandler(async (req, res) => {
    res.json({ suggestion: await suggestionForList(routeId(req)) });
  })
);
