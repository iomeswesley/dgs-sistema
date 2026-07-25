import "@/lib/timezone.js";
import { env } from "@/config/env.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Sistema DGS (API) em http://localhost:${env.PORT}`);
});
