/**
 * /api/v1/income – monthly income management
 */
const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const requireAuth = require('../middlewares/requireAuth');

const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
let userIncome;
let dbReady = false;

// MongoDB setup
async function initDb() {
  if (!dbReady) {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'pf_dev');
    userIncome = db.collection('user_income');
    dbReady = true;
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

// GET / – get all monthly income records for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = new ObjectId(req.userId);
    const incomeDoc = await userIncome.findOne({ userId });
    // income: { "2024-01": { total, sources: { salary: 50000, freelance: 10000 } }, ... }
    res.json({ income: incomeDoc?.income || {} });
  } catch (err) {
    console.error('Failed to fetch income records:', err);
    res.status(500).json({ error: 'failed to fetch income records' });
  }
});

// POST / – set or update the income for a specific month for the authenticated user
// Expects: { month: "YYYY-MM", total: number, sources?: { [sourceName]: number } }
router.post('/', async (req, res) => {
  const { month, total, sources } = req.body || {};

  if (
    !month ||
    typeof month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(month) ||
    typeof total !== 'number' ||
    total < 0
  ) {
    return res.status(400).json({
      error: 'month (YYYY-MM) and total (non-negative number) are required'
    });
  }

  // Validate and process sources if provided
  let finalSources = { main: total };

  if (sources !== undefined) {
    if (typeof sources !== 'object' || Array.isArray(sources)) {
      return res.status(400).json({ error: 'sources must be an object' });
    }

    // Check if all source values are numbers
    for (const [key, value] of Object.entries(sources)) {
      if (typeof value !== 'number' || value < 0) {
        return res.status(400).json({
          error: `source '${key}' must be a non-negative number`
        });
      }
    }

    // Calculate total from sources
    const sourcesTotal = Object.values(sources).reduce((sum, amount) => sum + amount, 0);

    // Check if sources total exceeds declared total
    if (sourcesTotal > total) {
      return res.status(400).json({
        error: `sources total (${sourcesTotal}) cannot exceed declared total (${total})`
      });
    }

    // If sources total is less than declared total, add miscellaneous
    if (sourcesTotal < total) {
      const miscAmount = total - sourcesTotal;
      finalSources = {
        ...sources,
        miscellaneous: miscAmount
      };
    } else {
      // Sources total equals declared total
      finalSources = sources;
    }
  }

  try {
    const userId = new ObjectId(req.userId);
    const incomeData = {
      total,
      sources: finalSources,
      updatedAt: new Date()
    };

    // Set or update the income for the given month
    await userIncome.updateOne(
      { userId },
      { $set: { [`income.${month}`]: incomeData } },
      { upsert: true }
    );

    res.status(201).json({
      message: 'income for month set/updated',
      income: incomeData
    });
  } catch (err) {
    console.error('Failed to set/update income:', err);
    res.status(500).json({ error: 'failed to set/update income' });
  }
});

// GET /:month – get the income for a specific month for the authenticated user
router.get('/:month', async (req, res) => {
  const { month } = req.params;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }

  try {
    const userId = new ObjectId(req.userId);
    // Project only the requested month for speed
    const incomeDoc = await userIncome.findOne(
      { userId },
      { projection: { [`income.${month}`]: 1, _id: 0 } }
    );

    res.json({
      month,
      income: incomeDoc?.income?.[month] || null
    });
  } catch (err) {
    console.error('Failed to fetch monthly income:', err);
    res.status(500).json({ error: 'failed to fetch monthly income' });
  }
});

// PUT /:month – modify/update the income for a specific month
// Expects: { total?: number, sources?: { [sourceName]: number } }
router.put('/:month', async (req, res) => {
  const { month } = req.params;
  const { total, sources } = req.body || {};

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }

  if (!total && !sources) {
    return res.status(400).json({
      error: 'either total or sources must be provided for update'
    });
  }

  // Validate total if provided
  if (total !== undefined && (typeof total !== 'number' || total < 0)) {
    return res.status(400).json({ error: 'total must be a non-negative number' });
  }

  // Validate sources if provided
  if (sources !== undefined) {
    if (typeof sources !== 'object' || Array.isArray(sources)) {
      return res.status(400).json({ error: 'sources must be an object' });
    }

    for (const [key, value] of Object.entries(sources)) {
      if (typeof value !== 'number' || value < 0) {
        return res.status(400).json({
          error: `source '${key}' must be a non-negative number`
        });
      }
    }
  }

  try {
    const userId = new ObjectId(req.userId);

    // Check if income record exists for this month
    const existingDoc = await userIncome.findOne(
      { userId },
      { projection: { [`income.${month}`]: 1 } }
    );

    if (!existingDoc?.income?.[month]) {
      return res.status(404).json({ error: 'No income record found for this month' });
    }

    const existingIncome = existingDoc.income[month];
    const updateFields = {};

    // Determine final total and sources
    const finalTotal = total !== undefined ? total : existingIncome.total;
    let finalSources = sources !== undefined ? sources : existingIncome.sources;

    // If both total and sources are being updated, validate them together
    if (total !== undefined && sources !== undefined) {
      const sourcesTotal = Object.values(sources).reduce((sum, amount) => sum + amount, 0);

      if (sourcesTotal > total) {
        return res.status(400).json({
          error: `sources total (${sourcesTotal}) cannot exceed declared total (${total})`
        });
      }

      if (sourcesTotal < total) {
        const miscAmount = total - sourcesTotal;
        finalSources = {
          ...sources,
          miscellaneous: miscAmount
        };
      }
    }
    // If only total is updated, adjust existing sources
    else if (total !== undefined && sources === undefined) {
      const existingSourcesTotal = Object.values(existingIncome.sources).reduce((sum, amount) => sum + amount, 0);

      if (existingSourcesTotal > total) {
        return res.status(400).json({
          error: `existing sources total (${existingSourcesTotal}) exceeds new total (${total}). Please update sources as well.`
        });
      }

      if (existingSourcesTotal < total) {
        const miscAmount = total - existingSourcesTotal;
        finalSources = {
          ...existingIncome.sources,
          miscellaneous: miscAmount
        };
      }
    }
    // If only sources are updated, validate against existing total
    else if (sources !== undefined && total === undefined) {
      const sourcesTotal = Object.values(sources).reduce((sum, amount) => sum + amount, 0);

      if (sourcesTotal > finalTotal) {
        return res.status(400).json({
          error: `sources total (${sourcesTotal}) cannot exceed existing total (${finalTotal})`
        });
      }

      if (sourcesTotal < finalTotal) {
        const miscAmount = finalTotal - sourcesTotal;
        finalSources = {
          ...sources,
          miscellaneous: miscAmount
        };
      }
    }

    if (total !== undefined) {
      updateFields[`income.${month}.total`] = finalTotal;
    }

    updateFields[`income.${month}.sources`] = finalSources;
    updateFields[`income.${month}.updatedAt`] = new Date();

    await userIncome.updateOne(
      { userId },
      { $set: updateFields }
    );

    res.json({
      message: 'income for month updated successfully',
      income: {
        total: finalTotal,
        sources: finalSources,
        updatedAt: new Date()
      }
    });
  } catch (err) {
    console.error('Failed to update monthly income:', err);
    res.status(500).json({ error: 'failed to update monthly income' });
  }
});

// DELETE /:month – delete income record for a specific month
router.delete('/:month', async (req, res) => {
  const { month } = req.params;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }

  try {
    const userId = new ObjectId(req.userId);

    const result = await userIncome.updateOne(
      { userId },
      { $unset: { [`income.${month}`]: "" } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'No income records found for user' });
    }

    res.json({ message: 'income record deleted successfully' });
  } catch (err) {
    console.error('Failed to delete monthly income:', err);
    res.status(500).json({ error: 'failed to delete monthly income' });
  }
});

module.exports = router;
