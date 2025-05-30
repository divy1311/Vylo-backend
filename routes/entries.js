/**
 * /api/v1/categories – built-in & custom categories
 */
const express = require('express');
const router  = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const requireAuth = require('../middlewares/requireAuth');

// MongoDB setup (reuse connection if already established)
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
let userEntries;
let dbReady = false;

async function initDb() {
  if (!dbReady) {
    try {
      await client.connect();
      const db = client.db(process.env.MONGO_DB || 'pf_dev');
      userEntries = db.collection('user_entries');
      dbReady = true;
      console.log('MongoDB connected for user_entries');
    } catch (err) {
      console.error('MongoDB connection error:', err);
      dbReady = false;
    }
  }
}
initDb();

router.use(requireAuth);

// Middleware to ensure DB is ready before handling requests
router.use(async (req, res, next) => {
  if (!dbReady) {
    await initDb();
    if (!dbReady) {
      return res.status(500).json({ error: 'Database not available' });
    }
  }
  next();
});

// GET / – all categories
router.get('/', async (req, res) => {
  res.json({ categories });
});


// POST /add-user-entries – add purchase entries for the authenticated user
router.post('/add-user-entries', async (req, res) => {
  const { entries, date } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date in YYYY-MM-DD format required' });
  }

  // Basic schema validation for each entry
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      typeof entry.code !== 'string' ||
      typeof entry.amount !== 'number' ||
      typeof entry.item !== 'string' ||
      (entry.confidence !== undefined && typeof entry.confidence !== 'number')
    ) {
      return res.status(400).json({ error: 'invalid entry schema' });
    }
  }

  try {
    const userId = new ObjectId(req.userId);
    const [year, month, day] = date.split('-');
    const yearMonth = `${year}-${month}`;

    // Push new entries into the user's entries array for specific date
    const result = await userEntries.updateOne(
      { userId },
      { $push: { [`${yearMonth}.${day}.entries`]: { $each: entries } } },
      { upsert: true }
    );

    if (result.acknowledged) {
      res.status(201).json({ message: 'entries added' });
    } else {
      res.status(500).json({ error: 'failed to add user entries' });
    }
  } catch (err) {
    console.error('Failed to add user entries:', err);
    res.status(500).json({ error: 'failed to add user entries' });
  }
});

module.exports = router;
