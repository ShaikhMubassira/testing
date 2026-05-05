import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { CONFIG } from "./config/constants.js";
import { registerSocketHandlers } from "./socket/handlers.js";

dotenv.config();

const app = express();
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (req, res) => {
  res.json({ status: "ok", test: "/test.html" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CONFIG.CORS_ORIGIN
  }
});

registerSocketHandlers(io);

server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${CONFIG.PORT}`);
  if (process.env.NODE_ENV === "production") {
    console.log("[server] deployed and ready for connections");
  }
});
