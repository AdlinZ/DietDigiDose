import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import inventoryRoutes from "./routes/inventory.js";
import dietRecordsRoutes from "./routes/diet-records.js";
import healthDataRoutes from "./routes/health-data.js";
import recipesRoutes from "./routes/recipes.js";
import foodsRoutes from "./routes/foods.js";
import communityRoutes from "./routes/community.js";
import adminRoutes from "./routes/admin.js";
import aiRoutes from "./routes/ai.js";
import kitchenwareRoutes from "./routes/kitchenware.js";

import { initDatabase } from "./storage/db.js";

const app = express();
const port = process.env.PORT || 9091;
const staticAssetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8081,http://localhost:19006,http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Init SQLite DB
initDatabase();

// Middleware

app.use(cors({
  origin(origin, callback) {
    // Native apps and server-to-server requests do not send an Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // Do not turn a rejected browser origin into a 500 response or expose a stack trace.
    return callback(null, false);
  },
}));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ limit: "12mb", extended: true }));
app.use("/media", express.static(staticAssetsDir, { maxAge: "7d" }));

app.get('/api/v1/health', (req, res) => {
  console.log('Health check success');
  res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/diet-records', dietRecordsRoutes);
app.use('/api/v1/health-data', healthDataRoutes);
app.use('/api/v1/recipes', recipesRoutes);
app.use('/api/v1/foods', foodsRoutes);
app.use('/api/v1/community', communityRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/kitchenware', kitchenwareRoutes);

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
