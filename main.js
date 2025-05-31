/**
 * Personal Finance Backend – main entry
 * -------------------------------------
 * Basic Express server skeleton wiring all core API routes.
 * Each route file (e.g. ./routes/auth.js) should export an Express router.
 * Environment variables:
 *   PORT                – server port (default 4000)
 *   DATABASE_URL        – Postgres / Mongo connection string
 *   JWT_SECRET          – signing key for auth tokens
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const requireAuth = require('./middlewares/requireAuth');
require('dotenv').config();

const authRoutes         = require('./routes/auth');
const receiptRoutes      = require('./routes/receipts');
const entriesRoutes     = require('./routes/entries');
const budgetRoutes       = require('./routes/budgets');
const shoppingRoutes     = require('./routes/shopping');
const incomeRoutes       = require('./routes/income');
const savingsRoutes      = require('./routes/savings');

const app = express();

// ───── Middlewares ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));   // large payloads for images
app.use(morgan('dev'));

// ───── API Routes (versioned) ────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);        // signup / login / refresh
app.use('/api/v1/receipts', requireAuth, receiptRoutes);
app.use('/api/v1/entries', requireAuth,  entriesRoutes);
app.use('/api/v1/budgets',      budgetRoutes);
app.use('/api/v1/income',     requireAuth, incomeRoutes); // income entries
app.use('/api/v1/savings',    requireAuth, savingsRoutes);
app.use('/api/v1/shopping',     shoppingRoutes);

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ───── Server bootstrap ─────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`👛 Personal Finance API listening on port ${PORT}`)
);

module.exports = app;
