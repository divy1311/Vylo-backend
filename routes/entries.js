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

// GET / – get user entries filtered by category and month
router.get('/', async (req, res) => {
  const { category, month } = req.query;

  // Parse categories (can be single or multiple)
  let categories = [];
  if (category) {
    categories = Array.isArray(category) ? category : [category];
  }

  // Parse months (can be single or multiple)
  let months = [];
  if (month) {
    months = Array.isArray(month) ? month : [month];

    // Validate month parameter format (YYYY-MM)
    const invalidMonth = months.find(m => !/^\d{4}-\d{2}$/.test(m));
    if (invalidMonth) {
      return res.status(400).json({ error: 'month parameters must be in YYYY-MM format' });
    }
  }

  // At least one filter must be provided
  if (months.length === 0) {
    return res.status(400).json({ error: 'at least one month parameter is required' });
  }

  try {
    const userId = new ObjectId(req.userId);
    const result = [];

    // Process each requested month
    for (const currentMonth of months) {
      // Query entries for the specific user and month
      const userMonthData = await userEntries.findOne(
        { userId },
        { projection: { [currentMonth]: 1, _id: 0 } }
      );

      if (!userMonthData || !userMonthData[currentMonth]) {
        continue; // Skip if no data for this month
      }

      const monthData = userMonthData[currentMonth];

      // Iterate through each day in the month data
      Object.keys(monthData).forEach(day => {
        if (monthData[day]?.entries) {
          // Filter entries by the requested categories (or get all if no category filter)
          let matchingEntries = monthData[day].entries;

          if (categories.length > 0) {
            matchingEntries = matchingEntries.filter(entry =>
              categories.includes(entry.code)
            );
          }

          // Add matching entries with their date
          matchingEntries.forEach(entry => {
            result.push({
              ...entry,
              date: `${currentMonth}-${day}`
            });
          });
        }
      });
    }

    res.json({ entries: result });
  } catch (err) {
    console.error('Failed to retrieve user entries:', err);
    res.status(500).json({ error: 'failed to retrieve user entries' });
  }
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

// DELETE /:date/:entryId - Delete a specific entry by ID
router.delete('/:date/:entryId', async (req, res) => {
  const { date, entryId } = req.params;

  // Validate date format (YYYY-MM-DD)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  // Validate entryId format
  if (!entryId) {
    return res.status(400).json({ error: 'entry ID is required' });
  }

  try {
    const userId = new ObjectId(req.userId);
    const [year, month, day] = date.split('-');
    const yearMonth = `${year}-${month}`;

    // Find and update the document to remove the specific entry
    const result = await userEntries.updateOne(
      { userId, [`${yearMonth}.${day}.entries`]: { $exists: true } },
      { $pull: { [`${yearMonth}.${day}.entries`]: { id: entryId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'No entries found for this date' });
    }

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Entry not found with the specified ID' });
    }

    res.json({ message: 'entry deleted successfully' });
  } catch (err) {
    console.error('Failed to delete entry:', err);
    res.status(500).json({ error: 'failed to delete entry' });
  }
});

// DELETE /:date - Delete all entries for a specific date
router.delete('/:date', async (req, res) => {
  const { date } = req.params;

  // Validate if it's a date (YYYY-MM-DD) or a month (YYYY-MM)
  let isFullDate = false;
  let yearMonth, day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // It's a full date (YYYY-MM-DD)
    isFullDate = true;
    [yearMonth, day] = [date.substring(0, 7), date.substring(8, 10)];
  } else if (/^\d{4}-\d{2}$/.test(date)) {
    // It's a month (YYYY-MM)
    yearMonth = date;
  } else {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD or YYYY-MM format' });
  }

  try {
    const userId = new ObjectId(req.userId);
    let result;

    if (isFullDate) {
      // Delete entries for specific day
      result = await userEntries.updateOne(
        { userId },
        { $unset: { [`${yearMonth}.${day}`]: "" } }
      );
    } else {
      // Delete entries for entire month
      result = await userEntries.updateOne(
        { userId },
        { $unset: { [`${yearMonth}`]: "" } }
      );
    }

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'No entries found for user' });
    }

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: `No entries found for ${isFullDate ? 'this date' : 'this month'}` });
    }

    res.json({
      message: `entries for ${isFullDate ? date : 'month ' + yearMonth} deleted successfully`
    });
  } catch (err) {
    console.error('Failed to delete entries:', err);
    res.status(500).json({ error: 'failed to delete entries' });
  }
});

module.exports = router;
