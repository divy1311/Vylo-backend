/**
 * /api/v1/budgets – envelope budgets
 */
const express = require('express');
const router  = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const requireAuth = require('../middlewares/requireAuth');
const categories = require('../data/categories.json');

const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
let userBudgets;
let userEntries;
let dbReady = false;

// MongoDB setup
async function initDb() {
  if (!dbReady) {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'pf_dev');
    userBudgets = db.collection('user_budgets');
    userEntries = db.collection('user_entries');
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

// GET / – get all monthly budgets for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = new ObjectId(req.userId);
    const budgetDoc = await userBudgets.findOne({ userId });
    // budgets: { "2024-01": { total, categories }, ... }
    res.json({ budgets: budgetDoc?.budgets || {} });
  } catch (err) {
    console.error('Failed to fetch budgets:', err);
    res.status(500).json({ error: 'failed to fetch budgets' });
  }
});

// POST / – set or update the budget for a specific month for the authenticated user
// Expects: { month: "YYYY-MM", total: number, categories: { [categoryCode]: number } }
router.post('/', async (req, res) => {
  const { month, total, categories } = req.body || {};
  if (
    !month ||
    typeof month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(month) ||
    typeof total !== 'number' ||
    typeof categories !== 'object' ||
    Array.isArray(categories)
  ) {
    return res.status(400).json({ error: 'month (YYYY-MM), total (number), and categories (object) are required' });
  }
  try {
    const userId = new ObjectId(req.userId);
    // Set or update the budget for the given month
    await userBudgets.updateOne(
      { userId },
      { $set: { [`budgets.${month}`]: { total, categories } } },
      { upsert: true }
    );
    res.status(201).json({ message: 'budget for month set/updated' });
  } catch (err) {
    console.error('Failed to set/update budgets:', err);
    res.status(500).json({ error: 'failed to set/update budgets' });
  }
});

// GET /:month – get the budget for a specific month for the authenticated user
router.get('/:month', async (req, res) => {
  const { month } = req.params;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  try {
    const userId = new ObjectId(req.userId);
    // Project only the requested month for speed
    const budgetDoc = await userBudgets.findOne(
      { userId },
      { projection: { [`budgets.${month}`]: 1, _id: 0 } }
    );
    res.json({ month, budget: budgetDoc?.budgets?.[month] || null });
  } catch (err) {
    console.error('Failed to fetch monthly budget:', err);
    res.status(500).json({ error: 'failed to fetch monthly budget' });
  }
});

// GET /:month/remaining – get remaining budget after deducting expenses for a specific month
router.get('/:month/remaining', async (req, res) => {
  const { month } = req.params;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  try {
    const userId = new ObjectId(req.userId);

    // Get budget for this month
    const budgetDoc = await userBudgets.findOne({ userId });
    const monthlyBudget = budgetDoc?.budgets?.[month];

    if (!monthlyBudget) {
      return res.status(404).json({ error: 'No budget set for this month' });
    }

    // Get expenses for this month
    const entriesDoc = await userEntries.findOne({ userId });
    const monthlyEntries = entriesDoc?.[month] || {};

    // Calculate total expenses by category
    const expensesByCategory = {};
    let miscellaneousExpenses = 0;

    Object.values(monthlyEntries).forEach(dayData => {
      if (dayData.entries) {
        dayData.entries.forEach(entry => {
          const categoryCode = entry.code;
          const amount = entry.amount || 0;

          // Check for exact match first
          if (monthlyBudget.categories[categoryCode]) {
            expensesByCategory[categoryCode] = (expensesByCategory[categoryCode] || 0) + amount;
          } else {
            // Check if this is a child category and parent has budget
            const parentCategory = categories.find(cat => cat.code === categoryCode)?.parent;
            if (parentCategory && monthlyBudget.categories[parentCategory]) {
              expensesByCategory[parentCategory] = (expensesByCategory[parentCategory] || 0) + amount;
            } else {
              // Goes to miscellaneous
              miscellaneousExpenses += amount;
            }
          }
        });
      }
    });

    // Calculate remaining budgets
    const remainingBudgets = {};
    const totalAllocated = Object.values(monthlyBudget.categories).reduce((sum, amount) => sum + amount, 0);
    const miscellaneousBudget = monthlyBudget.total - totalAllocated;

    Object.entries(monthlyBudget.categories).forEach(([categoryCode, budgetAmount]) => {
      const spent = expensesByCategory[categoryCode] || 0;
      remainingBudgets[categoryCode] = budgetAmount - spent;
    });

    remainingBudgets['MIS'] = miscellaneousBudget - miscellaneousExpenses;

    const totalSpent = Object.values(expensesByCategory).reduce((sum, amount) => sum + amount, 0) + miscellaneousExpenses;
    const totalRemaining = monthlyBudget.total - totalSpent;

    res.json({
      month,
      originalBudget: monthlyBudget,
      totalSpent,
      totalRemaining,
      remainingBudgets,
      expensesByCategory: {
        ...expensesByCategory,
        'MIS': miscellaneousExpenses
      }
    });
  } catch (err) {
    console.error('Failed to calculate remaining budget:', err);
    res.status(500).json({ error: 'failed to calculate remaining budget' });
  }
});

// POST /:month/reassign – allow user to move expense from miscellaneous to specific category
// Expects: { entryId: string, fromCategory: "MIS", toCategory: string, amount: number }
router.post('/:month/reassign', async (req, res) => {
  const { month } = req.params;
  const { entryId, fromCategory, toCategory, amount } = req.body || {};

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }

  if (!entryId || !fromCategory || !toCategory || typeof amount !== 'number') {
    return res.status(400).json({ error: 'entryId, fromCategory, toCategory, and amount are required' });
  }

  try {
    const userId = new ObjectId(req.userId);

    // Create/update budget reassignments collection
    const db = client.db(process.env.MONGO_DB || 'pf_dev');
    const reassignments = db.collection('budget_reassignments');

    await reassignments.updateOne(
      { userId, month, entryId },
      {
        $set: {
          userId,
          month,
          entryId,
          fromCategory,
          toCategory,
          amount,
          reassignedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.status(201).json({ message: 'expense reassigned successfully' });
  } catch (err) {
    console.error('Failed to reassign expense:', err);
    res.status(500).json({ error: 'failed to reassign expense' });
  }
});

module.exports = router;
