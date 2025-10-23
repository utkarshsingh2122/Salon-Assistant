// api/src/server.js
import dotenv from 'dotenv';
dotenv.config(); // load .env BEFORE anything else

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import cors from 'cors';

import { router as apiRouter } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// static assets (UI)
app.use('/', express.static(path.join(__dirname, 'public')));

// api routes
app.use('/', apiRouter);

// 404 fallback for unknown API routes
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] listening on http://localhost:${PORT}`);
});
