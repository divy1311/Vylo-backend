# Personal Finance Backend API

A comprehensive backend service for personal finance management built with Node.js, Express, and MongoDB. Features receipt processing with OCR, expense categorization using AI, budget management, income tracking, and product price comparison.

## 🚀 Features (Till 2025-05-31)

- **Receipt Processing**: OCR text extraction using Google Vision API
- **AI Expense Classification**: Automatic expense categorization using DeepSeek-R1 LLM
- **Budget Management**: Monthly envelope budgeting with category-wise tracking
- **Income Tracking**: Monthly income recording with multiple source support
- **Shopping Search**: Product price comparison across 50+ Indian e-commerce stores
- **User Authentication**: JWT-based authentication system
- **Expense Tracking**: Daily expense entries with detailed categorization

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB
- **Authentication**: JSON Web Tokens (JWT)
- **OCR**: Google Vision API
- **AI**: DeepSeek-R1-70B
- **Web Scraping**: Axios + Cheerio

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or cloud instance)
- Google Vision API key
- Together AI API key

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Personal-Finance/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=4000
   MONGO_URI=mongodb://localhost:27017
   MONGO_DB=pf_dev
   JWT_SECRET=your_jwt_secret_key_here
   GOOGLE_VISION_KEY=your_google_vision_api_key
   TOGETHER_API_KEY=your_together_ai_api_key
   ```

4. **Start the server**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

## 📁 Project Structure

```
backend/
├── data/
│   └── categories.json          # Expense categories configuration
├── middlewares/
│   └── requireAuth.js          # JWT authentication middleware
├── prompts/
│   └── deepseekClassifierPrompt.js  # AI classification prompt
├── routes/
│   ├── auth.js                 # Authentication endpoints
│   ├── budgets.js              # Budget management
│   ├── entries.js              # Expense entries
│   ├── receipts.js             # Receipt processing & OCR
│   ├── shopping.js             # Product price comparison
│   └── income.js               # Income management
├── main.js                     # Application entry point
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Refresh JWT token

### Receipt Processing
- `POST /api/v1/receipts/parse` - Extract text from receipt image
- `POST /api/v1/receipts/classify` - Classify expenses using AI

### Expense Management
- `GET /api/v1/entries/:month` - Get expenses for a month
- `POST /api/v1/entries/:month` - Add expenses for a month
- `PUT /api/v1/entries/:month/:day` - Update daily expenses

### Budget Management
- `GET /api/v1/budgets` - Get all monthly budgets
- `POST /api/v1/budgets` - Create/update monthly budget
- `GET /api/v1/budgets/:month` - Get specific month budget
- `GET /api/v1/budgets/:month/remaining` - Get remaining budget

### Income Management
- `GET /api/v1/income` - Get all monthly income records
- `POST /api/v1/income` - Set/create monthly income
- `GET /api/v1/income/:month` - Get specific month income
- `PUT /api/v1/income/:month` - Update monthly income
- `DELETE /api/v1/income/:month` - Delete monthly income record

### Shopping Price Comparison
- `POST /api/v1/shopping/search` - Search products (most relevant)
- `POST /api/v1/shopping/cheapest` - Search products (cheapest first)
- `GET /api/v1/shopping/stores` - Get supported stores

### System
- `GET /api/v1/health` - Health check endpoint

## 💰 Budget Categories

The system supports hierarchical expense categories:

- **FOD** - Food & Dining
  - FOD-REST - Restaurants & Cafés
  - FOD-DEL - Food Delivery
  - FOD-GRO - Groceries & Liquor

- **HOU** - Housing & Utilities
- **TRN** - Transport
- **SHO** - Shopping & Personal Goods
- **HFC** - Health & Fitness
- **EDU** - Education & Learning
- **ENT** - Entertainment & Leisure
- **FIN** - Finance & Investments
- **GOV** - Government Fees & Taxes
- **GFT** - Gifts & Donations
- **PER** - Personal Care & Services
- **MIS** - Miscellaneous

## 🛒 Supported E-commerce Stores

The shopping API supports 50+ Indian e-commerce platforms including:

- **Groceries**: BigBasket, Blinkit, JioMart
- **Electronics**: Amazon, Flipkart, Croma, Reliance Digital
- **Fashion**: Myntra, Ajio, H&M, Zara
- **Home**: Pepperfry, Urban Ladder, IKEA
- **Health**: 1mg, PharmEasy, Apollo Pharmacy
- **And many more...**

## 🔐 Authentication

All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## 📊 Sample API Calls

### Process Receipt
```bash
curl -X POST http://localhost:4000/api/v1/receipts/parse \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"image_b64": "base64_encoded_image"}'
```

### Set Monthly Budget
```bash
curl -X POST http://localhost:4000/api/v1/budgets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "month": "2024-01",
    "total": 50000,
    "categories": {
      "FOD": 15000,
      "HOU": 20000,
      "TRN": 8000
    }
  }'
```

### Set Monthly Income
```bash
curl -X POST http://localhost:4000/api/v1/income \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "month": "2024-01",
    "total": 75000,
    "sources": {
      "salary": 65000,
      "freelance": 10000
    }
  }'
```

### Update Monthly Income
```bash
curl -X PUT http://localhost:4000/api/v1/income/2024-01 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "total": 80000,
    "sources": {
      "salary": 65000,
      "freelance": 15000
    }
  }'
```

### Search Products
```bash
curl -X POST http://localhost:4000/api/v1/shopping/search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"query": "iPhone 15 128GB", "country": "in"}'
```

## 🐛 Error Handling

The API returns standardized error responses:
```json
{
  "error": "Description of the error"
}
```

Common HTTP status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `404` - Not Found
- `500` - Internal Server Error

## 🚀 Deployment

1. **Environment Setup**
   - Set production environment variables
   - Ensure MongoDB is accessible
   - Configure API keys

2. **Build and Start**
   ```bash
   npm install --production
   npm start
   ```

3. **Process Management** (optional)
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start main.js --name "personal-finance-api"
   ```

## 🔧 Development

### Running Tests
```bash
npm test
```

### Code Formatting
```bash
npm run lint
```

### Database Setup
Ensure MongoDB is running and create the required database:
```javascript
use pf_dev
db.createCollection('user_budgets')
db.createCollection('user_entries')
db.createCollection('user_income')
db.createCollection('budget_reassignments')
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📞 Support

For support or questions, please create an issue in the repository.
