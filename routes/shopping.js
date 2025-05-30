const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();
const requireAuth = require('../middlewares/requireAuth');

router.use(requireAuth);

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 5.1.1; SM-G928X Build/LMY47X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.83 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Mobile Safari/537.36 Edge/13.10586',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.2214.38 Safari/537.36',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'
];

/**
 * Makes request to Google Shopping
 * @param {string} searchTerm - Product search query
 * @param {string} country - Country code (default: "in")
 * @returns {Promise<string>} HTML content
 */
async function makeRequest(searchTerm, country = 'in') {
    const escapedSearchTerm = encodeURIComponent(searchTerm);
    // Updated URL format - removed tbs=vw:g which might be causing issues
    const googleUrl = `https://www.google.com/search?tbm=shop&q=${escapedSearchTerm}&gl=${country}&hl=en`;

    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(googleUrl, {
            headers: {
                'User-Agent': randomUserAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive'
            },
            timeout: 30000
        });

        console.log(`Request successful for: ${searchTerm}, URL: ${googleUrl}`);
        return response.data;
    } catch (error) {
        console.error('Request failed:', error.message);
        throw error;
    }
}

// Allowed stores organized by category
const ALLOWED_STORES = {
    'FOD-GRO': ['BigBasket', 'Blinkit', 'Grofers', 'Amazon Pantry', 'Flipkart Grocery', 'JioMart', 'Nature\'s Basket', 'Spencer\'s', 'DMart Ready'],
    'SHO-ELE': ['Amazon', 'Flipkart', 'Croma', 'Reliance Digital', 'Vijay Sales', 'Tata CLiQ', 'Tata CLiQ Digital', 'Samsung', 'Mi', 'ShopMi', 'Sony Centre'],
    'SHO-CLO': ['Myntra', 'Ajio', 'Tata CLiQ Fashion', 'H&M', 'Zara', 'Puma', 'Nike', 'Koovs', 'Lifestyle', 'Shoppers Stop'],
    'SHO-HOM': ['Pepperfry', 'Urban Ladder', 'IKEA', 'HomeTown', 'Wooden Street', 'Amazon Home', 'Flipkart Home'],
    'HFC': ['1mg', 'Netmeds', 'PharmEasy', 'Apollo Pharmacy', 'Cure.fit', 'Cult.fit', 'Decathlon'],
    'EDU-SUB': ['Amazon Books', 'Flipkart Books', 'Crossword'],
    'ENT': ['BookMyShow', 'MakeMyTrip', 'Yatra', 'OYO', 'Booking.com', 'Airbnb']
};

// Flatten all allowed stores for easy lookup
const ALL_ALLOWED_STORES = Object.values(ALLOWED_STORES).flat().map(store => store.toLowerCase());

/**
 * Check if a store name matches any of the allowed stores
 * @param {string} storeName - The store name to check
 * @returns {boolean} Whether the store is allowed
 */
function isAllowedStore(storeName) {
    const normalizedStore = storeName.toLowerCase();
    return ALL_ALLOWED_STORES.some(allowedStore =>
        normalizedStore.includes(allowedStore) || allowedStore.includes(normalizedStore)
    );
}

/**
 * Parses HTML content to extract product information
 * @param {string} html - HTML content from Google Shopping
 * @returns {Array} Array of product objects
 */
function parseContent(html) {
    const $ = cheerio.load(html);
    const results = [];
    const seenTitles = new Set(); // Track seen titles to avoid duplicates

    // Debug: Log page structure
    console.log('Page title:', $('title').text());

    // Write HTML to file for debugging
    require('fs').writeFileSync('/tmp/shopping-debug.html', html);
    console.log('HTML saved to /tmp/shopping-debug.html for debugging');

    // Try the most current Google Shopping selectors - be more specific
    const selectors = [
        'div[data-docid]:not([data-docid=""])',  // Must have actual docid
        'div.sh-dgr__grid-result',
        'div.PLla-d',
        'div.sh-dlr__list-result'
        // Removed generic div[jscontroller] as it's too broad
    ];

    let items = $();
    for (const selector of selectors) {
        items = $(selector);
        if (items.length > 0) {
            console.log(`Found ${items.length} items using selector: ${selector}`);
            break;
        }
    }

    // If still no items, try a more targeted alternative approach
    if (items.length === 0) {
        console.log('Trying alternative approach - looking for product containers');

        // Look for divs that are likely product containers
        items = $('div').filter((i, el) => {
            const $el = $(el);
            const text = $el.text();

            // Must have price, reasonable content length, and not be nested too deep
            const hasPrice = /[₹$]\s*[\d,]+/.test(text);
            const hasContent = text.length > 50 && text.length < 1000;
            const hasLinks = $el.find('a').length > 0;
            const notTooDeep = $el.parents('div').length < 10; // Avoid deeply nested divs

            return hasPrice && hasContent && hasLinks && notTooDeep;
        });

        console.log(`Alternative approach found ${items.length} potential product items`);
    }

    // Limit to first 20 items to avoid processing too many
    items = items.slice(0, 20);

    items.each((index, element) => {
        try {
            const $item = $(element);
            const fullText = $item.text();

            console.log(`\n=== Processing item ${index + 1} ===`);

            // Extract title using multiple strategies
            let title = '';

            // Strategy 1: Look for headings (but exclude very generic ones)
            const headings = $item.find('h1, h2, h3, h4, h5, h6');
            if (headings.length > 0) {
                const headingText = headings.first().text().trim();
                if (headingText.length > 10 && !headingText.includes('Shop by price')) {
                    title = headingText;
                }
            }

            // Strategy 2: Look for product title in links
            if (!title || title.length < 10) {
                const productLinks = $item.find('a[href*="shopping"], a[href*="merchant"]');
                productLinks.each((i, link) => {
                    const linkText = $(link).text().trim();
                    if (linkText.length > 10 && linkText.length < 150 &&
                        !linkText.includes('Shop by price') &&
                        !linkText.includes('View offer')) {
                        title = linkText;
                        return false; // break
                    }
                });
            }

            // Strategy 3: Extract from clean text lines
            if (!title || title.length < 10) {
                const lines = fullText.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 10 && line.length < 150)
                    .filter(line => !line.includes('Shop by price') &&
                                   !line.includes('View offer') &&
                                   !line.match(/^[₹$]\s*[\d,]+/)); // Not just a price

                if (lines.length > 0) {
                    title = lines[0];
                }
            }

            // Skip if title is too generic or already seen
            if (!title || title.length < 10 || seenTitles.has(title.toLowerCase())) {
                if (title && seenTitles.has(title.toLowerCase())) {
                    console.log(`Skipping duplicate title: "${title}"`);
                }
                return; // Skip this item
            }

            // Extract price using regex patterns
            let price = '';
            let numericPrice = 0;

            const priceMatches = fullText.match(/[₹$]\s*([\d,]+(?:\.\d{2})?)/g);
            if (priceMatches && priceMatches.length > 0) {
                price = priceMatches[0];
                const numbers = price.match(/[\d,]+(?:\.\d{2})?/);
                if (numbers) {
                    numericPrice = parseFloat(numbers[0].replace(/,/g, ''));
                }
            }

            // Skip if no valid price
            if (!numericPrice || numericPrice <= 0) {
                console.log(`Skipping item with invalid price: ${price}`);
                return;
            }

            // Extract store name - enhanced logic
            let store = 'Unknown';

            // Enhanced store patterns focused on Indian e-commerce
            const storePatterns = [
                // Specific Indian e-commerce patterns
                /(BigBasket|Blinkit|Grofers|JioMart|Nature\'s Basket|Spencer\'s|DMart)/i,
                /(Amazon|Flipkart|Croma|Reliance Digital|Vijay Sales)/i,
                /(Myntra|Ajio|H&M|Zara|Puma|Nike|Koovs|Lifestyle|Shoppers Stop)/i,
                /(Pepperfry|Urban Ladder|IKEA|HomeTown|Wooden Street)/i,
                /(1mg|Netmeds|PharmEasy|Apollo|Cure\.fit|Cult\.fit|Decathlon)/i,
                /(BookMyShow|MakeMyTrip|Yatra|OYO|Booking\.com|Airbnb)/i,
                // Generic patterns
                /(?:from\s+|by\s+|at\s+)([A-Za-z0-9\s\.]+?)(?:\s+₹|\s+\$|$)/i,
                /([A-Za-z0-9]+(?:\.[a-z]{2,3})?)\s*₹/i,
                /([a-zA-Z0-9]+\.com)/i,
                /\(([A-Za-z0-9\s]+)\)/,
                /Shop\s+at\s+([A-Za-z0-9\s]+)/i
            ];

            for (const pattern of storePatterns) {
                const match = fullText.match(pattern);
                if (match && match[1] && match[1].trim().length > 2) {
                    store = match[1].trim().replace(/\.com$/, ''); // Remove .com suffix
                    break;
                }
            }

            // Fallback: Look in specific HTML elements that might contain store info
            if (store === 'Unknown') {
                const storeSelectors = [
                    '.merchant-name',
                    '[data-merchant]',
                    '.store-name',
                    '.seller-name',
                    '.aULzUe'  // Google Shopping merchant class
                ];

                for (const selector of storeSelectors) {
                    const storeEl = $item.find(selector);
                    if (storeEl.length && storeEl.text().trim().length > 2) {
                        store = storeEl.text().trim();
                        break;
                    }
                }
            }

            // Extract link - improved logic to capture actual product URLs
            let link = '';

            // Try multiple link extraction strategies
            const linkStrategies = [
                // Strategy 1: Look for shopping-specific links
                () => $item.find('a[href*="/shopping/product/"]').first().attr('href'),
                () => $item.find('a[href*="/aclk"]').first().attr('href'),
                () => $item.find('a[href*="merchant"]').first().attr('href'),

                // Strategy 2: Look for any external links (non-Google)
                () => {
                    const links = $item.find('a[href]');
                    for (let i = 0; i < links.length; i++) {
                        const href = $(links[i]).attr('href');
                        if (href && !href.startsWith('/') && !href.includes('google.com')) {
                            return href;
                        }
                    }
                    return null;
                },

                // Strategy 3: Look for any link with meaningful href
                () => {
                    const links = $item.find('a[href]');
                    for (let i = 0; i < links.length; i++) {
                        const href = $(links[i]).attr('href');
                        if (href && href.length > 10) {
                            return href;
                        }
                    }
                    return null;
                }
            ];

            // Try each strategy until we find a link
            for (const strategy of linkStrategies) {
                const foundLink = strategy();
                if (foundLink) {
                    link = foundLink;
                    break;
                }
            }

            // Convert relative URLs to absolute and decode if needed
            if (link) {
                if (link.startsWith('/')) {
                    link = `https://www.google.com${link}`;
                }

                // If it's a Google redirect link, try to extract the actual URL
                if (link.includes('/url?') || link.includes('/aclk?')) {
                    try {
                        const url = new URL(link);
                        const actualUrl = url.searchParams.get('url') ||
                                         url.searchParams.get('adurl') ||
                                         url.searchParams.get('q');
                        if (actualUrl) {
                            link = decodeURIComponent(actualUrl);
                        }
                    } catch (e) {
                        console.log('Failed to decode redirect URL:', e.message);
                    }
                }
            }

            console.log(`Extracted - Title: "${title.substring(0, 50)}", Price: ₹${numericPrice}, Store: ${store}, Link: ${link.substring(0, 60)}...`);

            // Only add if we have valid data AND the store is allowed AND title is unique
            if (title && title.length > 10 && numericPrice > 0 && isAllowedStore(store)) {
                seenTitles.add(title.toLowerCase()); // Mark as seen
                results.push({
                    title: title.substring(0, 100),
                    price: numericPrice,
                    rawPrice: price,
                    store: store,
                    reviews: 0,
                    stars: 0,
                    link: link
                });
            } else if (title && title.length > 10 && numericPrice > 0) {
                console.log(`Filtered out store: ${store} (not in allowed list)`);
            }
        } catch (error) {
            console.log('Error processing item:', error.message);
        }
    });

    console.log(`\nFinal result: Extracted ${results.length} unique products from allowed stores`);
    return results;
}

/**
 * Scrapes Google Shopping for the top relevant offers of a product
 * @param {string} query - Product search query
 * @param {string} country - Country code (default: "in")
 * @returns {Promise<Array|null>} Top 5 relevant offers or null
 */
async function getRelevantOffers(query, country = "in") {
    try {
        const html = await makeRequest(query, country);
        let products = parseContent(html);

        if (!products || products.length === 0) {
            return null;
        }

        // Products are already filtered by allowed stores in parseContent()
        // Return top 5 most relevant results (no sorting by price)
        return products.slice(0, 5);

    } catch (error) {
        console.error('Scraping error:', error);
        return null;
    }
}

// POST /search – find top 5 most relevant offers for a product
router.post('/search', async (req, res) => {
    const { query, country } = req.body || {};

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'query is required' });
    }

    if (country && (typeof country !== 'string' || !/^[a-z]{2}$/.test(country))) {
        return res.status(400).json({ error: 'country must be a 2-letter code' });
    }

    try {
        const offers = await getRelevantOffers(query.trim(), country || 'in');

        if (!offers || offers.length === 0) {
            return res.status(404).json({ error: 'No offers found for this product' });
        }

        res.json({
            query: query.trim(),
            country: country || 'in',
            results: offers,
            count: offers.length
        });
    } catch (err) {
        console.error('Failed to find offers:', err);
        res.status(500).json({ error: 'failed to search for offers' });
    }
});

// POST /cheapest – find top 5 cheapest offers for a product
router.post('/cheapest', async (req, res) => {
    const { query, country } = req.body || {};

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'query is required' });
    }

    if (country && (typeof country !== 'string' || !/^[a-z]{2}$/.test(country))) {
        return res.status(400).json({ error: 'country must be a 2-letter code' });
    }

    try {
        const html = await makeRequest(query.trim(), country || 'in');
        let products = parseContent(html);

        if (!products || products.length === 0) {
            return res.status(404).json({ error: 'No offers found for this product' });
        }

        // Sort by price for cheapest endpoint
        const offers = products
            .sort((a, b) => a.price - b.price)
            .slice(0, 5);

        res.json({
            query: query.trim(),
            country: country || 'in',
            topOffers: offers,
            count: offers.length
        });
    } catch (err) {
        console.error('Failed to find cheapest offers:', err);
        res.status(500).json({ error: 'failed to search for offers' });
    }
});

// GET /stores – get list of allowed stores organized by category
router.get('/stores', (req, res) => {
    res.json({
        storesByCategory: ALLOWED_STORES,
        allStores: ALL_ALLOWED_STORES,
        message: 'Only results from these stores will be returned. Pass store names in the websites array to filter further.'
    });
});

module.exports = router;
