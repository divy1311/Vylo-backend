/**
 * /api/v1/savings – monthly and yearly savings calculation
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
let userEntries;
let dbReady = false;

// MongoDB setup
async function initDb() {
  if (!dbReady) {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'pf_dev');
    userIncome = db.collection('user_income');
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

/**
 * Calculate total expenses for a specific month
 * @param {ObjectId} userId - User ID
 * @param {string} month - Month in YYYY-MM format
 * @returns {Promise<number>} Total expenses for the month
 */
async function calculateMonthlyExpenses(userId, month) {
  const entriesDoc = await userEntries.findOne({ userId });
  const monthlyEntries = entriesDoc?.[month] || {};
  
  let totalExpenses = 0;
  Object.values(monthlyEntries).forEach(dayData => {
    if (dayData.entries) {
      dayData.entries.forEach(entry => {
        totalExpenses += entry.amount || 0;
      });
    }
  });
  
  return totalExpenses;
}

/**
 * Get income for a specific month
 * @param {ObjectId} userId - User ID
 * @param {string} month - Month in YYYY-MM format
 * @returns {Promise<number>} Total income for the month
 */
async function getMonthlyIncome(userId, month) {
  const incomeDoc = await userIncome.findOne(
    { userId },
    { projection: { [`income.${month}`]: 1 } }
  );
  
  return incomeDoc?.income?.[month]?.total || 0;
}

// GET /:month/monthly – calculate savings for a specific month
router.get('/:month/monthly', async (req, res) => {
  const { month } = req.params;
  
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }

  try {
    const userId = new ObjectId(req.userId);
    
    // Get income and expenses for the month
    const [totalIncome, totalExpenses] = await Promise.all([
      getMonthlyIncome(userId, month),
      calculateMonthlyExpenses(userId, month)
    ]);
    
    const savings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? ((savings / totalIncome) * 100).toFixed(2) : 0;

    res.json({
      month,
      totalIncome,
      totalExpenses,
      savings,
      savingsRate: parseFloat(savingsRate),
      summary: savings >= 0 ? 'positive savings' : 'overspent'
    });
  } catch (err) {
    console.error('Failed to calculate monthly savings:', err);
    res.status(500).json({ error: 'failed to calculate monthly savings' });
  }
});

// GET /:year/yearly – calculate savings for an entire year
router.get('/:year/yearly', async (req, res) => {
  const { year } = req.params;
  
  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'year must be in YYYY format' });
  }

  try {
    const userId = new ObjectId(req.userId);
    
    // Generate all months for the year
    const months = [];
    for (let i = 1; i <= 12; i++) {
      months.push(`${year}-${i.toString().padStart(2, '0')}`);
    }
    
    // Calculate savings for each month
    const monthlyData = [];
    let totalYearlyIncome = 0;
    let totalYearlyExpenses = 0;
    
    for (const month of months) {
      const [monthlyIncome, monthlyExpenses] = await Promise.all([
        getMonthlyIncome(userId, month),
        calculateMonthlyExpenses(userId, month)
      ]);
      
      const monthlySavings = monthlyIncome - monthlyExpenses;
      const monthlySavingsRate = monthlyIncome > 0 ? ((monthlySavings / monthlyIncome) * 100).toFixed(2) : 0;
      
      totalYearlyIncome += monthlyIncome;
      totalYearlyExpenses += monthlyExpenses;
      
      monthlyData.push({
        month,
        income: monthlyIncome,
        expenses: monthlyExpenses,
        savings: monthlySavings,
        savingsRate: parseFloat(monthlySavingsRate)
      });
    }
    
    const totalYearlySavings = totalYearlyIncome - totalYearlyExpenses;
    const yearlyAverageSavingsRate = totalYearlyIncome > 0 ? 
      ((totalYearlySavings / totalYearlyIncome) * 100).toFixed(2) : 0;
    
    // Calculate monthly averages
    const monthsWithData = monthlyData.filter(m => m.income > 0 || m.expenses > 0);
    const avgMonthlyIncome = monthsWithData.length > 0 ? 
      totalYearlyIncome / monthsWithData.length : 0;
    const avgMonthlyExpenses = monthsWithData.length > 0 ? 
      totalYearlyExpenses / monthsWithData.length : 0;
    const avgMonthlySavings = avgMonthlyIncome - avgMonthlyExpenses;

    res.json({
      year,
      summary: {
        totalIncome: totalYearlyIncome,
        totalExpenses: totalYearlyExpenses,
        totalSavings: totalYearlySavings,
        averageSavingsRate: parseFloat(yearlyAverageSavingsRate),
        monthsWithData: monthsWithData.length
      },
      averages: {
        monthlyIncome: Math.round(avgMonthlyIncome),
        monthlyExpenses: Math.round(avgMonthlyExpenses),
        monthlySavings: Math.round(avgMonthlySavings)
      },
      monthlyBreakdown: monthlyData,
      insights: {
        bestSavingsMonth: monthlyData.reduce((best, current) => 
          current.savings > best.savings ? current : best
        ),
        worstSavingsMonth: monthlyData.reduce((worst, current) => 
          current.savings < worst.savings ? current : worst
        ),
        consistentSaver: monthlyData.filter(m => m.savings > 0).length >= 9
      }
    });
  } catch (err) {
    console.error('Failed to calculate yearly savings:', err);
    res.status(500).json({ error: 'failed to calculate yearly savings' });
  }
});

// GET /summary/:year – get a quick savings summary for the year
router.get('/summary/:year', async (req, res) => {
  const { year } = req.params;
  
  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'year must be in YYYY format' });
  }

  try {
    const userId = new ObjectId(req.userId);
    
    // Get current month for year-to-date calculations
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear().toString();
    const currentMonth = currentDate.getMonth() + 1;
    
    // Calculate up to current month if it's the current year
    const monthsToCalculate = year === currentYear ? currentMonth : 12;
    
    let totalIncome = 0;
    let totalExpenses = 0;
    let monthsWithIncome = 0;
    
    for (let i = 1; i <= monthsToCalculate; i++) {
      const month = `${year}-${i.toString().padStart(2, '0')}`;
      const [monthlyIncome, monthlyExpenses] = await Promise.all([
        getMonthlyIncome(userId, month),
        calculateMonthlyExpenses(userId, month)
      ]);
      
      totalIncome += monthlyIncome;
      totalExpenses += monthlyExpenses;
      
      if (monthlyIncome > 0) monthsWithIncome++;
    }
    
    const totalSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? ((totalSavings / totalIncome) * 100).toFixed(2) : 0;
    
    res.json({
      year,
      period: year === currentYear ? 'year-to-date' : 'full-year',
      monthsCovered: monthsToCalculate,
      monthsWithIncome,
      totalIncome,
      totalExpenses,
      totalSavings,
      savingsRate: parseFloat(savingsRate),
      status: totalSavings >= 0 ? 'saving' : 'overspending'
    });
  } catch (err) {
    console.error('Failed to get savings summary:', err);
    res.status(500).json({ error: 'failed to get savings summary' });
  }
});

module.exports = router;
