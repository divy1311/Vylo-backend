/**
 * /api/v1/auth  –  signup, login, token refresh
 * -------------------------------------------------
 * ENV VARS NEEDED
 *   MONGO_URI        mongodb://localhost:27017
 *   MONGO_DB         pf_dev            (database name)
 *   JWT_SECRET       super-secret-key
 *
 * TOKENS
 *   access : 15 min  (sent as Authorization: Bearer <token>)
 *   refresh:  7 days (stored client-side – e.g. Secure Http-Only cookie)
 */

const express     = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');

const router      = express.Router();
const ACCESS_TTL  = '15m';
const REFRESH_TTL = '7d';

/* ─────────── Mongo singleton ─────────── */
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
let users;   // will be set once the connection opens

(async () => {
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'pf_dev');
  users = db.collection('users');
  // ensure email is unique
  await users.createIndex({ email: 1 }, { unique: true });
  console.log('↳ Users collection ready');
})().catch(console.error);

/* ─────────── helpers ─────────── */
function generateTokens(userId) {
  const payload = { sub: userId.toString() };
  const accessToken  = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ ...payload, typ: 'refresh' }, process.env.JWT_SECRET, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

/* ─────────── ROUTES ─────────── */

/**
 * POST /api/v1/auth/signup
 * { "email": "...", "password": "..." }
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const hash = await bcrypt.hash(password, 10);
    const { insertedId } = await users.insertOne({ email, passwordHash: hash, createdAt: new Date() });

    const tokens = generateTokens(insertedId);
    res.status(201).json({ userId: insertedId, ...tokens });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'email already registered' });
    console.error(err);
    res.status(500).json({ error: 'signup failed' });
  }
});

/**
 * POST /api/v1/auth/login
 * { "email": "...", "password": "..." }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const tokens = generateTokens(user._id);
    res.json({ userId: user._id, ...tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'login failed' });
  }
});

/**
 * POST /api/v1/auth/refresh
 * { "refreshToken": "..." }
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.typ !== 'refresh') throw new Error('not a refresh token');

    // Optionally: check a token blacklist or jti here

    const tokens = generateTokens(decoded.sub);
    res.json(tokens);
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired refresh token' });
  }
});

/* -----------------------------------------------------------
 * DELETE /api/v1/auth/delete
 * Header: Authorization: Bearer <accessToken>
 * Deletes the authenticated user and all their data.
 * Returns 204 No Content.
 * ----------------------------------------------------------- */
const requireAuth = require('../middlewares/requireAuth');   // adjust path

router.delete('/delete', requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.userId);

    // 1) delete user doc
    await users.deleteOne({ _id: userId });

    // 2) cascade: drop related docs (ignore errors if coll missing)
    const db = client.db(process.env.MONGO_DB || 'pf_dev');
    const collections = ['receipts', 'transactions', 'budgets', 'insights'];

    await Promise.all(
      collections.map((name) =>
        db.collection(name).deleteMany({ userId })
          .catch((e) => console.warn(`${name} not found:`, e.message))
      )
    );

    return res.status(204).end();        // success, no body
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'delete failed' });
  }
});

module.exports = router;
