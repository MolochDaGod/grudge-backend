import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";

const app = express();

// ============================================
// CORS — Dynamic origin matching
// ============================================

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "https://grudgewarlords.com,https://grudge-studio.com,http://localhost:5173"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const isAllowed =
      allowedOrigins.includes(origin) ||
      /\.vercel\.app$/.test(origin) ||
      /\.grudge-studio\.com$/.test(origin);

    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
    }
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ============================================
// REQUEST LOGGING
// ============================================

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") || path.startsWith("/auth")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }
      console.log(`[API] ${logLine}`);
    }
  });

  next();
});

// ============================================
// BOOT
// ============================================

(async () => {
  const server = await registerRoutes(app);

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[ERROR] ${status} ${message}`);
    res.status(status).json({ error: message });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║       Grudge Studio — Unified Backend            ║
╠══════════════════════════════════════════════════╣
║  API:        http://0.0.0.0:${port}                     ║
║  WebSocket:  ws://0.0.0.0:${port}/ws                    ║
╚══════════════════════════════════════════════════╝

Endpoints:
  POST   /api/auth/register   — Create account
  POST   /api/auth/login      — Login
  POST   /api/auth/guest      — Guest login
  POST   /api/auth/puter      — Puter login
  POST   /api/auth/verify     — Verify token
  GET    /auth/discord         — Discord OAuth
  GET    /api/characters       — List characters
  POST   /api/characters       — Create character
  DELETE /api/characters/:id   — Delete character
  POST   /api/wallet/create    — Create Crossmint wallet
  GET    /api/wallet            — Get wallet info
  GET    /api/profile           — Get user profile
  GET    /api/metadata          — Game metadata
  GET    /api/health            — Health check
  WS     /ws                    — Game bridge
`);
  });
})();
