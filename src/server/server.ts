import express from "express";
import http from "node:http";
import path from "node:path";
import { ensureRuntimeState } from "./bootstrap";
import { config, validateProductionConfig } from "./config";
import { createAppRouter, configureStatic, configureUploads } from "./routes";
import { applySecurityHeaders, requireCsrf, requireTrustedOrigin } from "./security";
import { configureSocket } from "./socket";

async function main(): Promise<void> {
  validateProductionConfig();
  await ensureRuntimeState();

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));
  app.use(applySecurityHeaders);
  configureUploads(app);

  app.use("/api", requireTrustedOrigin, requireCsrf, createAppRouter());

  if (process.env.NODE_ENV === "production" || hasBuiltClient()) {
    configureStatic(app);
  } else {
    app.get("/", (_request, response) => {
      response.json({
        service: "Moderator Overlay API",
        client: "Run npm run dev for the Vite client, or npm run build && npm start."
      });
    });
  }

  const httpServer = http.createServer(app);
  configureSocket(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`Moderator Overlay server listening on http://localhost:${config.port}`);
  });
}

function hasBuiltClient(): boolean {
  return process.env.NODE_ENV !== "development" && path.isAbsolute(path.resolve("dist/client"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
