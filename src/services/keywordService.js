/**
 * 🔍 Keyword Research Service
 * 
 * Handles keyword research, search volume estimation, and competitor discovery.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('keyword-service');

// ─── User Agents for Rotation ───
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ─── Advanced Location Hierarchy ───
const LOCATION_HIERARCHY = {
    // Countries
    'india': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India' },
    'united states': { gl: 'us', hl: 'en', google: 'google.com', country: 'United States' },
    'usa': { gl: 'us', hl: 'en', google: 'google.com', country: 'United States' },
    'us': { gl: 'us', hl: 'en', google: 'google.com', country: 'United States' },
    'united kingdom': { gl: 'gb', hl: 'en', google: 'google.co.uk', country: 'United Kingdom' },
    'uk': { gl: 'gb', hl: 'en', google: 'google.co.uk', country: 'United Kingdom' },
    'canada': { gl: 'ca', hl: 'en', google: 'google.ca', country: 'Canada' },
    'australia': { gl: 'au', hl: 'en', google: 'google.com.au', country: 'Australia' },
    'germany': { gl: 'de', hl: 'de', google: 'google.de', country: 'Germany' },
    'france': { gl: 'fr', hl: 'fr', google: 'google.fr', country: 'France' },
    'spain': { gl: 'es', hl: 'es', google: 'google.es', country: 'Spain' },
    'italy': { gl: 'it', hl: 'it', google: 'google.it', country: 'Italy' },
    'brazil': { gl: 'br', hl: 'pt', google: 'google.com.br', country: 'Brazil' },
    'japan': { gl: 'jp', hl: 'ja', google: 'google.co.jp', country: 'Japan' },
    'singapore': { gl: 'sg', hl: 'en', google: 'google.com.sg', country: 'Singapore' },
    'uae': { gl: 'ae', hl: 'en', google: 'google.ae', country: 'UAE' },
    'dubai': { gl: 'ae', hl: 'en', google: 'google.ae', country: 'UAE', city: 'Dubai' },
    'saudi arabia': { gl: 'sa', hl: 'ar', google: 'google.com.sa', country: 'Saudi Arabia' },
    
    // Indian Cities
    'bengaluru': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore' },
    'bangalore': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore' },
    'mumbai': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai' },
    'delhi': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi' },
    'new delhi': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi' },
    'chennai': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Tamil Nadu', city: 'Chennai' },
    'hyderabad': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad' },
    'kolkata': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'West Bengal', city: 'Kolkata' },
    'pune': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Pune' },
    'ahmedabad': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Gujarat', city: 'Ahmedabad' },
    'jaipur': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Rajasthan', city: 'Jaipur' },
    'chandigarh': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Punjab', city: 'Chandigarh' },
    'kochi': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Kerala', city: 'Kochi' },
    'coimbatore': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Tamil Nadu', city: 'Coimbatore' },
    'mysore': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Mysore' },
    'gurugram': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Haryana', city: 'Gurugram' },
    'noida': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Uttar Pradesh', city: 'Noida' },
    'gurgaon': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Haryana', city: 'Gurugram' },
    'bhubaneswar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Odisha', city: 'Bhubaneswar' },
    'lucknow': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Uttar Pradesh', city: 'Lucknow' },
    'indore': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Madhya Pradesh', city: 'Indore' },
    
    // Bangalore Areas
    'whitefield': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Whitefield' },
    'marathahalli': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Marathahalli' },
    'koramangala': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Koramangala' },
    'hsr layout': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'HSR Layout' },
    'indiranagar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Indiranagar' },
    'jayanagar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Jayanagar' },
    'btm layout': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'BTM Layout' },
    'electronic city': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Electronic City' },
    'mg road': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'MG Road' },
    'brigade road': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Brigade Road' },
    'malleshwaram': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Malleshwaram' },
    'hebbal': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Hebbal' },
    'yelahanka': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Yelahanka' },
    'hn pura': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Hennur' },
    'hennur': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Hennur' },
    'krpuram': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'K.R. Puram' },
    'k.r. puram': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'K.R. Puram' },
    'banashankari': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'Banashankari' },
    'jp nagar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'JP Nagar' },
    'j.p. nagar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Karnataka', city: 'Bangalore', area: 'JP Nagar' },
    
    // Mumbai Areas
    'andheri': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Andheri' },
    'bandra': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Bandra' },
    'juhu': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Juhu' },
    'powai': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Powai' },
    'malad': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Malad' },
    ' Goregaon': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Mumbai', area: 'Goregaon' },
    'thane': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Thane', area: 'Thane' },
    'vashi': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Navi Mumbai', area: 'Vashi' },
    'navi mumbai': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Maharashtra', city: 'Navi Mumbai' },
    
    // Delhi/NCR Areas
    'gurgaon': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Haryana', city: 'Gurugram', area: 'Gurugram' },
    'gurugram': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Haryana', city: 'Gurugram', area: 'Gurugram' },
    'noida': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Uttar Pradesh', city: 'Noida', area: 'Noida' },
    'greater noida': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Uttar Pradesh', city: 'Greater Noida', area: 'Greater Noida' },
    'dwarka': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Dwarka' },
    'saket': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Saket' },
    'lajpat nagar': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Lajpat Nagar' },
    'rohini': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Rohini' },
    'janakpuri': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Janakpuri' },
    'connaught place': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Delhi', city: 'New Delhi', area: 'Connaught Place' },
    
    // Hyderabad Areas
    'gachibowli': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad', area: 'Gachibowli' },
    'hitech city': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad', area: 'Hitech City' },
    'kukatpally': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad', area: 'Kukatpally' },
    ' Jubilee Hills': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad', area: 'Jubilee Hills' },
    'banjara hills': { gl: 'in', hl: 'en', google: 'google.co.in', country: 'India', state: 'Telangana', city: 'Hyderabad', area: 'Banjara Hills' },
};

// Legacy support
const LOCATION_MAP = LOCATION_HIERARCHY;

function getLocationConfig(location) {
    const key = (location || 'india').toLowerCase();
    return LOCATION_MAP[key] || { gl: 'in', hl: 'en', google: 'google.co.in' };
}

// ─── Search Volume Estimation ───
async function estimateSearchVolume(keyword, location = 'India') {
    log.info({ keyword, location }, 'estimating search volume');

    try {
        // Method 1: Serper.dev (if API key available)
        if (config.apis.serper.key) {
            try {
                return await estimateViaSerper(keyword, location);
            } catch (err) {
                log.warn({ err: err.message }, 'Serper estimation failed, falling back to Google');
            }
        }

        // Method 2: Google Autocomplete + Related Searches
        return await estimateViaGoogle(keyword, location);
    } catch (err) {
        log.error({ err: err.message }, 'search volume estimation failed');
        return { volume: 0, competition: 'unknown', cpc: 0, difficulty: 0 };
    }
}

// ─── Estimate via Serper.dev ───
async function estimateViaSerper(keyword, location) {
    try {
        const response = await axios.post(config.apis.serper.url, {
            q: keyword,
            location: location,
            gl: location.toLowerCase().includes('india') ? 'in' : 'us',
            hl: 'en',
            num: 10,
        }, {
            headers: {
                'X-API-KEY': config.apis.serper.key,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        const data = response.data;
        
        // Estimate based on results count and related searches
        const resultCount = data.searchInformation?.totalResults || 0;
        const relatedSearches = data.relatedSearches || [];
        
        // Rough estimation algorithm
        let estimatedVolume = 0;
        
        if (resultCount > 10000000) estimatedVolume = 10000 + Math.floor(Math.random() * 5000);
        else if (resultCount > 1000000) estimatedVolume = 5000 + Math.floor(Math.random() * 3000);
        else if (resultCount > 100000) estimatedVolume = 1000 + Math.floor(Math.random() * 2000);
        else if (resultCount > 10000) estimatedVolume = 500 + Math.floor(Math.random() * 500);
        else estimatedVolume = 100 + Math.floor(Math.random() * 200);

        // Adjust based on keyword length (longer = less volume)
        const wordCount = keyword.split(' ').length;
        if (wordCount > 4) estimatedVolume = Math.floor(estimatedVolume * 0.5);
        else if (wordCount > 3) estimatedVolume = Math.floor(estimatedVolume * 0.7);

        // Estimate competition based on ads
        const ads = data.ads || [];
        let competition = 'low';
        if (ads.length > 4) competition = 'high';
        else if (ads.length > 2) competition = 'medium';

        // Estimate difficulty based on domain authority of top results
        const organic = data.organic || [];
        let avgDA = 50;
        if (organic.length > 0) {
            // Check if top results are from high-authority domains
            const highAuthDomains = ['wikipedia.org', 'forbes.com', 'hubspot.com', 'semrush.com', 'ahrefs.com'];
            const highAuthCount = organic.filter(r => 
                highAuthDomains.some(d => r.link?.includes(d))
            ).length;
            avgDA = 30 + (highAuthCount * 15);
        }

        return {
            volume: estimatedVolume,
            competition,
            cpc: ads.length > 0 ? (Math.random() * 2 + 0.5).toFixed(2) : 0,
            difficulty: Math.min(100, avgDA),
            relatedSearches: relatedSearches.map(r => r.query).slice(0, 8),
            resultCount,
        };
    } catch (err) {
        log.error({ err: err.message }, 'serper estimation failed');
        throw err;
    }
}

// ─── Estimate via Google Scraping ───
async function estimateViaGoogle(keyword, location) {
    try {
        const loc = getLocationConfig(location);
        const searchUrl = `https://www.${loc.google}/search?q=${encodeURIComponent(keyword)}&gl=${loc.gl}&hl=${loc.hl}&num=10`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': getRandomUA(),
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 10000,
        });

        const $ = cheerio.load(response.data);
        
        // Extract result count
        const resultStats = $('#result-stats').text();
        const resultMatch = resultStats.match(/[\d,]+/);
        const resultCount = resultMatch ? parseInt(resultMatch[0].replace(/,/g, '')) : 0;

        // Extract related searches (multiple methods)
        const relatedSearches = [];
        
        // Method 1: Links in related searches section
        $('a[href*="/search?q="]').each((i, el) => {
            const href = $(el).attr('href') || '';
            const text = $(el).text().trim();
            
            if (href.includes('/search?q=') && 
                text.length > 3 && 
                text.length < 100 &&
                !text.includes('http') &&
                !text.includes('Search') &&
                !text.includes('Next')) {
                
                const match = href.match(/\/search\?q=([^&]+)/);
                if (match) {
                    const query = decodeURIComponent(match[1].replace(/\+/g, ' '));
                    if (!relatedSearches.includes(query)) {
                        relatedSearches.push(query);
                    }
                }
            }
        });

        // Method 2: Look for "People also search for" section
        $('span').each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 5 && text.length < 80 && 
                !text.includes('http') && 
                !relatedSearches.includes(text)) {
                // Check if parent is a related search container
                const parent = $(el).parent();
                if (parent.attr('data-ved') || parent.hasClass('k8XOCe')) {
                    relatedSearches.push(text);
                }
            }
        });

        // ─── IMPROVED Volume Estimation Algorithm ───
        let estimatedVolume = 0;
        
        // Base volume from result count (logarithmic scale)
        if (resultCount > 100000000) estimatedVolume = 50000;
        else if (resultCount > 50000000) estimatedVolume = 30000;
        else if (resultCount > 10000000) estimatedVolume = 15000;
        else if (resultCount > 5000000) estimatedVolume = 8000;
        else if (resultCount > 1000000) estimatedVolume = 4000;
        else if (resultCount > 500000) estimatedVolume = 2000;
        else if (resultCount > 100000) estimatedVolume = 1000;
        else if (resultCount > 50000) estimatedVolume = 500;
        else if (resultCount > 10000) estimatedVolume = 200;
        else estimatedVolume = 50;

        // Adjust for keyword length (longer = less volume)
        const wordCount = keyword.split(' ').length;
        if (wordCount >= 5) estimatedVolume = Math.floor(estimatedVolume * 0.2);
        else if (wordCount >= 4) estimatedVolume = Math.floor(estimatedVolume * 0.35);
        else if (wordCount >= 3) estimatedVolume = Math.floor(estimatedVolume * 0.55);
        else if (wordCount >= 2) estimatedVolume = Math.floor(estimatedVolume * 0.75);

        // Adjust for commercial intent
        const commercialTerms = ['buy', 'price', 'cost', 'cheap', 'best', 'top', 'review', 'vs', 'compare'];
        const hasCommercialIntent = commercialTerms.some(t => keyword.toLowerCase().includes(t));
        if (hasCommercialIntent) estimatedVolume = Math.floor(estimatedVolume * 1.3);

        // Adjust for location modifiers
        const locationTerms = ['near me', 'in bangalore', 'in mumbai', 'in delhi', 'in india', 'local'];
        const hasLocationModifier = locationTerms.some(t => keyword.toLowerCase().includes(t));
        if (hasLocationModifier) estimatedVolume = Math.floor(estimatedVolume * 0.6);

        // Adjust for question keywords
        const questionTerms = ['how', 'what', 'why', 'when', 'where', 'who', 'which'];
        const isQuestion = questionTerms.some(t => keyword.toLowerCase().startsWith(t));
        if (isQuestion) estimatedVolume = Math.floor(estimatedVolume * 0.7);

        // Round to nice numbers
        if (estimatedVolume > 10000) estimatedVolume = Math.round(estimatedVolume / 1000) * 1000;
        else if (estimatedVolume > 1000) estimatedVolume = Math.round(estimatedVolume / 100) * 100;
        else estimatedVolume = Math.round(estimatedVolume / 10) * 10;

        // Check for ads (competition signal)
        const adCount = $('div[data-text-ad], .uEierd, .commercial-unit-desktop-top, [data-text-ad]').length;
        const hasShoppingResults = $('.commercial-unit-desktop-top, .sh-dgr__gr-auto').length > 0;
        
        let competition = 'low';
        if (adCount > 3 || hasShoppingResults) competition = 'high';
        else if (adCount > 1) competition = 'medium';

        // Estimate CPC based on competition
        let cpc = 0;
        if (competition === 'high') cpc = (1.5 + Math.random() * 2).toFixed(2);
        else if (competition === 'medium') cpc = (0.5 + Math.random() * 1).toFixed(2);
        else if (adCount > 0) cpc = (0.1 + Math.random() * 0.4).toFixed(2);

        // Estimate difficulty based on SERP analysis
        let difficulty = 30; // Base difficulty
        
        // Check for high-authority domains in top 10
        const highAuthDomains = ['wikipedia.org', 'forbes.com', 'hubspot.com', 'semrush.com', 'ahrefs.com', 'youtube.com', 'linkedin.com'];
        let highAuthCount = 0;
        $('div.g a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (highAuthDomains.some(d => href.includes(d))) highAuthCount++;
        });
        
        difficulty += highAuthCount * 8; // +8 per high-authority domain
        difficulty += competition === 'high' ? 15 : competition === 'medium' ? 5 : 0;
        difficulty += wordCount <= 2 ? 10 : 0; // Short keywords harder
        difficulty = Math.min(100, Math.max(10, difficulty));

        return {
            volume: estimatedVolume,
            competition,
            cpc: parseFloat(cpc),
            difficulty,
            relatedSearches: [...new Set(relatedSearches)].slice(0, 8),
            resultCount,
        };
    } catch (err) {
        log.error({ err: err.message }, 'google estimation failed');
        return { volume: 100, competition: 'unknown', cpc: 0, difficulty: 50, relatedSearches: [], resultCount: 0 };
    }
}

// ─── Get SERP Results ───
async function getSERPResults(keyword, location = 'India', numResults = 20) {
    log.info({ keyword, location, numResults }, 'fetching SERP results');

    try {
        if (config.apis.serper.key) {
            try {
                return await getSERPViaSerper(keyword, location, numResults);
            } catch (err) {
                log.warn({ err: err.message }, 'Serper SERP fetch failed, falling back to Google');
            }
        }
        return await getSERPViaGoogle(keyword, location, numResults);
    } catch (err) {
        log.error({ err: err.message }, 'SERP fetch failed');
        return [];
    }
}

// ─── SERP via Serper.dev ───
async function getSERPViaSerper(keyword, location, numResults) {
    const results = [];
    const pages = Math.ceil(numResults / 10);

    for (let page = 0; page < pages; page++) {
        try {
            const response = await axios.post(config.apis.serper.url, {
                q: keyword,
                location: location,
                gl: location.toLowerCase().includes('india') ? 'in' : 'us',
                hl: 'en',
                num: 10,
                page: page,
            }, {
                headers: {
                    'X-API-KEY': config.apis.serper.key,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            });

            const organic = response.data.organic || [];
            for (const result of organic) {
                results.push({
                    position: results.length + 1,
                    url: result.link,
                    domain: extractDomain(result.link),
                    title: result.title,
                    description: result.snippet,
                });
            }

            if (page < pages - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (err) {
            log.error({ page, err: err.message }, 'serper page fetch failed');
            break;
        }
    }

    return results.slice(0, numResults);
}

// ─── SERP via Google Scraping ───
async function getSERPViaGoogle(keyword, location, numResults) {
    const results = [];
    const pages = Math.ceil(numResults / 10);
    const loc = getLocationConfig(location);

    for (let page = 0; page < pages; page++) {
        try {
            const start = page * 10;
            const searchUrl = `https://www.${loc.google}/search?q=${encodeURIComponent(keyword)}&gl=${loc.gl}&hl=${loc.hl}&num=10&start=${start}`;
            
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': getRandomUA(),
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                timeout: 10000,
            });

            const $ = cheerio.load(response.data);
            
            $('div.g').each((i, el) => {
                const link = $(el).find('a').attr('href');
                const title = $(el).find('h3').text();
                const description = $(el).find('div[data-sncf], span.aCOpRe, div.VwiC3b').first().text();

                if (link && link.startsWith('http') && !link.includes('google.com')) {
                    results.push({
                        position: results.length + 1,
                        url: link,
                        domain: extractDomain(link),
                        title,
                        description,
                    });
                }
            });

            if (page < pages - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) {
            log.error({ page, err: err.message }, 'google page fetch failed');
            break;
        }
    }

    return results.slice(0, numResults);
}

// ─── Analyze Page Content ───
async function analyzePageContent(url, keyword) {
    log.info({ url, keyword }, 'analyzing page content');

    try {
        // Validate URL
        if (!url || !url.startsWith('http')) {
            throw new Error('Invalid URL: ' + url);
        }

        const response = await axios.get(url, {
            headers: { 
                'User-Agent': getRandomUA(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 20000,
            maxRedirects: 10,
            validateStatus: (status) => status < 500, // Accept 4xx but not 5xx
            httpsAgent: new (require('https').Agent)({ 
                rejectUnauthorized: false // Allow self-signed certs
            }),
        });

        const $ = cheerio.load(response.data);
        
        // Remove scripts, styles, nav, footer
        $('script, style, nav, footer, header, aside').remove();
        
        // Get main content
        const bodyText = $('body').text().toLowerCase();
        const words = bodyText.split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;

        // Count keyword occurrences
        const keywordLower = keyword.toLowerCase();
        const keywordWords = keywordLower.split(' ');
        
        // Exact phrase count
        const exactMatches = (bodyText.match(new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        
        // Individual word counts
        const wordCounts = {};
        keywordWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            wordCounts[word] = (bodyText.match(regex) || []).length;
        });

        // Calculate density
        const keywordDensity = wordCount > 0 ? ((exactMatches * keywordWords.length) / wordCount * 100).toFixed(2) : 0;

        // Check SEO elements
        const hasH1 = $('h1').length > 0;
        const h1Text = $('h1').first().text();
        const hasMetaDescription = $('meta[name="description"]').attr('content') ? true : false;
        const metaDescription = $('meta[name="description"]').attr('content') || '';
        
        // Check headings structure
        const headings = {
            h1: $('h1').length,
            h2: $('h2').length,
            h3: $('h3').length,
        };

        // Check images with alt text
        const images = $('img').length;
        const imagesWithAlt = $('img[alt]').length;

        // Check internal/external links
        const domain = extractDomain(url);
        let internalLinks = 0;
        let externalLinks = 0;
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href) {
                if (href.includes(domain) || href.startsWith('/') || href.startsWith('#')) {
                    internalLinks++;
                } else if (href.startsWith('http')) {
                    externalLinks++;
                }
            }
        });

        // Enhanced schema markup detection
        const schemaAnalysis = analyzeSchemaMarkup($);

        // Detect page type for schema suggestions
        const pageType = detectPageType($, h1Text, metaDescription);

        // Generate schema suggestions
        const schemaSuggestions = generateSchemaSuggestions(schemaAnalysis, pageType);

        return {
            url,
            wordCount,
            keywordAnalysis: {
                exactMatches,
                wordCounts,
                density: parseFloat(keywordDensity),
            },
            seoElements: {
                hasH1,
                h1Text,
                hasMetaDescription,
                metaDescription,
                headings,
                images,
                imagesWithAlt,
                internalLinks,
                externalLinks,
                hasSchema: schemaAnalysis.hasSchema,
                schemaDetails: schemaAnalysis,
                pageType,
                schemaSuggestions,
            },
        };
    } catch (err) {
        log.error({ url, err: err.message }, 'page analysis failed');
        return {
            url,
            wordCount: 0,
            keywordAnalysis: { exactMatches: 0, wordCounts: {}, density: 0 },
            seoElements: { hasH1: false, hasMetaDescription: false },
            error: err.message,
        };
    }
}

// ─── Analyze Schema Markup ───
function analyzeSchemaMarkup($) {
    const schemaScripts = $('script[type="application/ld+json"]');
    const schemaData = [];
    const detectedTypes = [];
    const errors = [];

    schemaScripts.each((i, el) => {
        try {
            const content = $(el).html();
            if (content) {
                const parsed = JSON.parse(content);
                const normalizedTypes = Array.isArray(parsed) ? parsed : [parsed];
                
                normalizedTypes.forEach(item => {
                    if (item['@type']) {
                        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                        types.forEach(type => {
                            const normalizedType = type.replace(/^https?:\/\/schema\.org\//, '');
                            if (!detectedTypes.includes(normalizedType)) {
                                detectedTypes.push(normalizedType);
                            }
                        });
                    }
                    
                    if (item['@graph']) {
                        item['@graph'].forEach(graphItem => {
                            if (graphItem['@type']) {
                                const types = Array.isArray(graphItem['@type']) ? graphItem['@type'] : [graphItem['@type']];
                                types.forEach(type => {
                                    const normalizedType = type.replace(/^https?:\/\/schema\.org\//, '');
                                    if (!detectedTypes.includes(normalizedType)) {
                                        detectedTypes.push(normalizedType);
                                    }
                                });
                            }
                        });
                    }
                    
                    schemaData.push({
                        index: i,
                        valid: true,
                        types: types,
                    });
                });
            }
        } catch (e) {
            errors.push({
                index: i,
                message: e.message,
            });
        }
    });

    return {
        hasSchema: schemaScripts.length > 0,
        count: schemaScripts.length,
        detectedTypes,
        schemaData,
        errors,
        isValid: errors.length === 0,
    };
}

// ─── Detect Page Type ───
function detectPageType($, h1Text, metaDescription) {
    const pageText = ($('main, article, .content, #content').text() || '').toLowerCase();
    const fullText = ($('body').text() || '').toLowerCase();
    const title = ($('title').text() || '').toLowerCase();
    const h2s = $('h2').map((i, el) => $(el).text().toLowerCase()).get();
    const h3s = $('h3').map((i, el) => $(el).text().toLowerCase()).get();
    const headings = [...h2s, ...h3s].join(' ');
    
    const pageTypes = [];
    
    // FAQ detection
    if (headings.includes('faq') || headings.includes('question') || headings.includes('?')) {
        pageTypes.push('FAQ');
    }
    
    // Article/Blog detection
    if ($('article').length > 0 || $('time[datetime]').length > 0 || $('meta[name="author"]').attr('content')) {
        pageTypes.push('Article');
    }
    
    // Product detection
    if (pageText.includes('price') && pageText.includes('add to cart')) {
        pageTypes.push('Product');
    }
    
    // Local Business detection
    if (pageText.includes('address') && pageText.includes('phone')) {
        pageTypes.push('LocalBusiness');
    }
    
    // Service detection
    if (pageText.includes('service') || pageText.includes('offer') || pageText.includes('solution')) {
        pageTypes.push('Service');
    }
    
    // Organization detection
    if (pageText.includes('about us') || pageText.includes('company') || pageText.includes('team')) {
        pageTypes.push('Organization');
    }
    
    // Contact detection
    if (pageText.includes('contact') || pageText.includes('email') || pageText.includes('phone')) {
        pageTypes.push('ContactPage');
    }
    
    // Default to WebPage
    if (pageTypes.length === 0) {
        pageTypes.push('WebPage');
    }
    
    return {
        primary: pageTypes[0],
        all: pageTypes,
    };
}

// ─── Generate Schema Suggestions ───
function generateSchemaSuggestions(schemaAnalysis, pageType) {
    const suggestions = [];
    const hasType = (type) => schemaAnalysis.detectedTypes.includes(type);
    
    // Suggest based on page type
    if (pageType.primary === 'FAQ' && !hasType('FAQPage')) {
        suggestions.push({
            type: 'FAQPage',
            priority: 'HIGH',
            reason: 'FAQ content detected - FAQ schema can show rich snippets in search',
            example: {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                'mainEntity': [
                    {
                        '@type': 'Question',
                        'name': 'Your question here?',
                        'acceptedAnswer': {
                            '@type': 'Answer',
                            'text': 'Your answer here.'
                        }
                    }
                ]
            }
        });
    }
    
    if (pageType.primary === 'Article' && !hasType('Article') && !hasType('BlogPosting')) {
        suggestions.push({
            type: 'Article',
            priority: 'HIGH',
            reason: 'Article/Blog content detected - Article schema improves rich snippets',
            fields: ['headline', 'author', 'datePublished', 'dateModified', 'image', 'publisher']
        });
    }
    
    if (pageType.primary === 'LocalBusiness' && !hasType('LocalBusiness') && !hasType('Organization')) {
        suggestions.push({
            type: 'LocalBusiness',
            priority: 'HIGH',
            reason: 'Local business content detected - LocalBusiness schema helps with local SEO',
            fields: ['name', 'address', 'telephone', 'openingHours', 'geo', 'image']
        });
    }
    
    if (pageType.primary === 'Service' && !hasType('Service')) {
        suggestions.push({
            type: 'Service',
            priority: 'MEDIUM',
            reason: 'Service content detected - Service schema helps with service-related searches',
            fields: ['name', 'description', 'provider', 'areaServed', 'priceRange']
        });
    }
    
    if (pageType.primary === 'Organization' && !hasType('Organization')) {
        suggestions.push({
            type: 'Organization',
            priority: 'MEDIUM',
            reason: 'Organization content detected - Organization schema helps with brand searches',
            fields: ['name', 'logo', 'url', 'sameAs (social links)']
        });
    }
    
    if (!hasType('WebSite')) {
        suggestions.push({
            type: 'WebSite',
            priority: 'LOW',
            reason: 'WebSite schema enables sitelinks search box in Google results',
            fields: ['name', 'url']
        });
    }
    
    if (!hasType('BreadcrumbList')) {
        suggestions.push({
            type: 'BreadcrumbList',
            priority: 'LOW',
            reason: 'Breadcrumb schema shows path in search results',
            fields: ['itemListElement']
        });
    }
    
    if (schemaAnalysis.errors.length > 0) {
        suggestions.push({
            type: 'VALIDATION_ERROR',
            priority: 'CRITICAL',
            reason: `${schemaAnalysis.errors.length} schema validation error(s) found`,
            errors: schemaAnalysis.errors.map(e => `Block ${e.index + 1}: ${e.message}`)
        });
    }
    
    return suggestions;
}

// ─── Get Domain Authority ───
async function getDomainAuthority(domain) {
    try {
        if (config.apis.openPageRank.key) {
            const response = await axios.get(
                `${config.apis.openPageRank.url}?domains%5B0%5D=${domain}`,
                {
                    headers: { 'API-OPR': config.apis.openPageRank.key },
                    timeout: 5000,
                }
            );
            
            if (response.data?.response?.[0]?.page_rank_integer !== undefined) {
                return response.data.response[0].page_rank_integer * 10;
            }
        }

        // Fallback: estimate based on domain characteristics
        let score = 30;
        if (domain.endsWith('.edu') || domain.endsWith('.gov')) score = 80;
        else if (domain.endsWith('.org')) score = 50;
        else if (domain.includes('wikipedia') || domain.includes('medium')) score = 90;
        else if (domain.split('.').length === 2) score = 40; // Short domains tend to be older

        return score;
    } catch (err) {
        log.debug({ domain, err: err.message }, 'DA check failed');
        return 30;
    }
}

// ─── Extract Domain from URL ───
function extractDomain(url) {
    if (!url) return '';
    try {
        let cleanUrl = url.trim().toLowerCase();
        if (!cleanUrl.startsWith('http')) {
            cleanUrl = 'https://' + cleanUrl;
        }
        const urlObj = new URL(cleanUrl);
        let host = urlObj.hostname;
        if (host.startsWith('www.')) host = host.substring(4);
        
        // Basic validation: ensure host has at least one dot and no trailing colon
        if (host.includes('.') && !host.endsWith(':')) {
            return host;
        }
        return url; // fallback to original if weird
    } catch {
        // Fallback for non-URL strings like "example.com"
        return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    }
}

// ─── Get Keyword Suggestions ───
async function getKeywordSuggestions(seed, location = 'India') {
    log.info({ seed, location }, 'getting keyword suggestions');

    const suggestions = [];
    const loc = getLocationConfig(location);

    try {
        // Method 1: Google Autocomplete (Firefox client)
        const autocompleteUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${loc.hl}&gl=${loc.gl}&q=${encodeURIComponent(seed)}`;
        
        const response = await axios.get(autocompleteUrl, {
            headers: { 
                'User-Agent': getRandomUA(),
                'Accept': 'application/json',
            },
            timeout: 5000,
        });

        // Parse autocomplete response
        if (Array.isArray(response.data) && Array.isArray(response.data[1])) {
            for (const s of response.data[1]) {
                if (s && s.length > 3) {
                    suggestions.push({
                        keyword: s,
                        type: 'autocomplete',
                        source: 'google',
                    });
                }
            }
        }

        log.info({ count: suggestions.length }, 'autocomplete suggestions found');
    } catch (err) {
        log.debug({ err: err.message }, 'autocomplete failed, trying alternatives');
    }

    try {
        // Method 2: Google SERP Related Searches (scraping)
        const searchUrl = `https://www.${loc.google}/search?q=${encodeURIComponent(seed)}&gl=${loc.gl}&hl=${loc.hl}`;
        const serpResponse = await axios.get(searchUrl, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 10000,
        });

        const $ = cheerio.load(serpResponse.data);
        
        // Extract "Related searches" section
        // Method A: Look for related search links
        $('a[href*="/search?q="]').each((i, el) => {
            const href = $(el).attr('href') || '';
            const text = $(el).text().trim();
            
            // Filter for related searches (not navigation)
            if (href.includes('/search?q=') && 
                !href.includes('&sa=') && 
                text.length > 3 && 
                text.length < 100 &&
                !text.includes('http')) {
                
                // Extract the query from href
                const match = href.match(/\/search\?q=([^&]+)/);
                if (match) {
                    const query = decodeURIComponent(match[1].replace(/\+/g, ' '));
                    if (!suggestions.find(s => s.keyword.toLowerCase() === query.toLowerCase())) {
                        suggestions.push({
                            keyword: query,
                            type: 'related',
                            source: 'google_serp',
                        });
                    }
                }
            }
        });

        // Method B: Look for "People also ask" questions
        $('[data-q] , [jsname]').each((i, el) => {
            const question = $(el).attr('data-q') || $(el).text().trim();
            if (question && question.includes('?') && question.length > 10) {
                if (!suggestions.find(s => s.keyword.toLowerCase() === question.toLowerCase())) {
                    suggestions.push({
                        keyword: question,
                        type: 'question',
                        source: 'paa',
                    });
                }
            }
        });

        log.info({ count: suggestions.length }, 'total suggestions after SERP parsing');
    } catch (err) {
        log.debug({ err: err.message }, 'SERP related searches failed');
    }

    try {
        // Method 3: Bing Suggestions (fallback)
        const bingUrl = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(seed)}&lang=en`;
        const bingResponse = await axios.get(bingUrl, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 5000,
        });

        if (Array.isArray(bingResponse.data) && Array.isArray(bingResponse.data[1])) {
            for (const s of bingResponse.data[1]) {
                if (s && s.length > 3 && !suggestions.find(existing => existing.keyword.toLowerCase() === s.toLowerCase())) {
                    suggestions.push({
                        keyword: s,
                        type: 'autocomplete',
                        source: 'bing',
                    });
                }
            }
        }

        log.info({ count: suggestions.length }, 'total suggestions after Bing');
    } catch (err) {
        log.debug({ err: err.message }, 'Bing suggestions failed');
    }

    // Deduplicate and limit
    const unique = [];
    const seen = new Set();
    
    for (const s of suggestions) {
        const key = s.keyword.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(s);
        }
    }

    log.info({ seed, total: unique.length }, 'keyword suggestions complete');
    return unique.slice(0, 20);
}

// ─── Advanced Keyword Research ───
async function advancedKeywordResearch(keyword, options = {}) {
    const { 
        location = 'India', 
        language = 'en',
        includeSerpFeatures = true,
        includeIntent = true,
        includeContentGap = true,
        includeCompetitorAnalysis = true,
        numResults = 20 
    } = options;

    log.info({ keyword, location }, 'starting advanced keyword research');

    const locationConfig = getLocationConfig(location);
    
    // Get base keyword data
    const volumeData = await estimateSearchVolume(keyword, location);
    const serpResults = await getSERPResults(keyword, location, numResults);
    
    // Analyze intent
    const intent = includeIntent ? analyzeKeywordIntent(keyword) : null;
    
    // Detect SERP features
    const serpFeatures = includeSerpFeatures ? await detectSERPFeatures(keyword, location, serpResults) : null;
    
    // Calculate opportunity score
    const opportunityScore = calculateOpportunityScore(volumeData, serpResults, intent, serpFeatures);
    
    // Analyze competitor content
    const contentGaps = includeContentGap ? analyzeContentGaps(serpResults) : null;
    
    // Get related keywords with expanded data
    const relatedKeywords = await getKeywordSuggestions(keyword, location);
    
    // Analyze top ranking pages
    const topPagesAnalysis = includeCompetitorAnalysis ? await analyzeTopPages(serpResults.slice(0, 5)) : null;
    
    // Multi-location comparison if requested
    const multiLocationAnalysis = options.compareLocations ? 
        await compareAcrossLocations(keyword, options.compareLocations) : null;

    // Generate comprehensive report
    return {
        keyword,
        location: {
            full: locationConfig,
            display: formatLocationDisplay(locationConfig),
        },
        metrics: {
            searchVolume: volumeData.volume,
            competition: volumeData.competition,
            cpc: {
                estimated: volumeData.cpc,
                range: estimateCPCRange(volumeData.competition, intent),
            },
            difficulty: volumeData.difficulty,
            opportunityScore,
            resultCount: volumeData.resultCount || 0,
        },
        competitors: serpResults.map(r => ({
            domain: r.domain,
            position: r.position,
            url: r.url,
            title: r.title,
            description: r.description,
        })),
        intent: intent ? {
            primary: intent.primary,
            secondary: intent.secondary,
            breakdown: intent.breakdown,
            stage: intent.stage,
            description: getIntentDescription(intent.primary),
        } : null,
        serpFeatures: serpFeatures ? {
            detected: serpFeatures.features,
            details: serpFeatures.details,
            competition: serpFeatures.competition,
            richResultsOpportunity: serpFeatures.richOpportunity,
        } : null,
        contentGaps: contentGaps ? {
            questionsNotAnswered: contentGaps.questions,
            topicsToCover: contentGaps.topics,
            contentLengthTarget: contentGaps.targetLength,
            missingElements: contentGaps.missingElements,
        } : null,
        topPagesAnalysis: topPagesAnalysis ? {
            averageWordCount: topPagesAnalysis.avgWordCount,
            averageH2Count: topPagesAnalysis.avgH2Count,
            commonHeadings: topPagesAnalysis.commonHeadings,
            averageDA: topPagesAnalysis.avgDA,
            recommendations: topPagesAnalysis.recommendations,
        } : null,
        relatedKeywords: relatedKeywords.slice(0, 15).map(k => ({
            keyword: k.keyword,
            type: k.type,
            intent: analyzeKeywordIntent(k.keyword),
        })),
        multiLocation: multiLocationAnalysis,
        timestamp: new Date().toISOString(),
    };
}

// ─── Analyze Keyword Intent ───
function analyzeKeywordIntent(keyword) {
    const lower = keyword.toLowerCase();
    const words = lower.split(' ');
    
    const intents = {
        informational: 0,
        navigational: 0,
        commercial: 0,
        transactional: 0,
    };
    
    // Informational keywords
    const infoWords = ['how', 'what', 'why', 'when', 'where', 'which', 'who', 'guide', 'tutorial', 'steps', 'tips', 'ideas', 'examples', 'meaning', 'difference', 'vs', 'versus', 'about', 'learn'];
    const infoPatterns = [/^what is/i, /^how to/i, /^how do/i, /^why does/i, /^can i/i, /^is it/i, /^are they/i];
    
    if (infoPatterns.some(p => p.test(keyword))) intents.informational += 3;
    if (infoWords.some(w => lower.includes(w))) intents.informational += 1;
    if (lower.includes('?') || words.length > 5) intents.informational += 1;
    
    // Navigational keywords
    const navPatterns = [/\b(login|sign in|signin|signup|register)\b/i, /^(facebook|youtube|twitter|instagram|linkedin)/i, /\b(app|official|website)\b/i];
    if (navPatterns.some(p => p.test(keyword))) intents.navigational += 5;
    if (lower.includes(' near me') || lower.includes(' nearby')) intents.navigational += 1;
    
    // Commercial keywords
    const commWords = ['best', 'top', 'review', 'reviews', 'compare', 'comparison', 'vs', 'versus', 'alternative', 'features', 'pros cons', 'honest'];
    if (commWords.some(w => lower.includes(w))) intents.commercial += 2;
    if (lower.includes('should i') || lower.includes('which one')) intents.commercial += 2;
    
    // Transactional keywords
    const transWords = ['buy', 'purchase', 'order', 'price', 'cost', 'deal', 'discount', 'coupon', 'cheap', 'free shipping', 'shop now', 'get quote'];
    const transPatterns = [/\bbuy\s+\w+$/i, /\bprice\s+of/i, /\bbuy\s+\w+\s+online/i, /\$\d+/];
    if (transWords.some(w => lower.includes(w))) intents.transactional += 2;
    if (transPatterns.some(p => p.test(keyword))) intents.transactional += 2;
    if (/\d+%\s*off/i.test(keyword)) intents.transactional += 3;
    
    // Determine primary and secondary intent
    const sorted = Object.entries(intents).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0][0];
    const secondary = sorted[1][0] || null;
    
    // Determine buyer's journey stage
    let stage = 'awareness';
    if (primary === 'transactional') stage = 'decision';
    else if (primary === 'commercial') stage = 'consideration';
    else if (primary === 'navigational') stage = 'loyalty';
    
    return {
        primary,
        secondary,
        breakdown: intents,
        stage,
        score: sorted[0][1],
    };
}

// ─── Detect SERP Features ───
async function detectSERPFeatures(keyword, location, serpResults) {
    const features = {
        featuredSnippet: false,
        peopleAlsoAsk: false,
        localPack: false,
        imagePack: false,
        videoResults: false,
        shoppingResults: false,
        knowledgeGraph: false,
        topStories: false,
        twitterCards: false,
        jobListing: false,
        eventListing: false,
    };
    
    const details = {};
    
    // Analyze SERP results for feature indicators
    const topDomains = serpResults.slice(0, 10).map(r => r.domain);
    const topTitles = serpResults.slice(0, 5).map(r => String(r.title)).join(' ').toLowerCase();
    const topDescriptions = serpResults.slice(0, 5).map(r => String(r.description)).join(' ').toLowerCase();
    const combined = topTitles + ' ' + topDescriptions;
    
    // Detect based on keyword patterns
    const lower = keyword.toLowerCase();
    
    // Featured snippet indicators
    if (lower.startsWith('what is') || lower.startsWith('how to') || lower.startsWith('why')) {
        features.featuredSnippet = true;
    }
    
    // People Also Ask
    if (lower.startsWith('how') || lower.startsWith('what') || lower.startsWith('why') || lower.startsWith('can')) {
        features.peopleAlsoAsk = true;
        details.peopleAlsoAskCount = Math.floor(Math.random() * 5) + 3;
    }
    
    // Local pack indicators
    const localKeywords = ['near me', 'nearby', 'in bangalore', 'in mumbai', 'in delhi', 'in chennai', 'in hyderabad', 'in pune', 'best restaurant', 'restaurant near', 'hotel near', 'clinic', 'doctor', 'salon'];
    if (localKeywords.some(k => lower.includes(k))) {
        features.localPack = true;
        details.localPackCount = Math.floor(Math.random() * 3) + 3;
    }
    
    // Image pack
    const imageKeywords = ['images', 'pictures', 'photos', 'wallpaper', 'design', 'logo', 'food', 'dress', 'shoes'];
    if (imageKeywords.some(k => lower.includes(k)) || combined.includes('image')) {
        features.imagePack = true;
    }
    
    // Video results
    const videoKeywords = ['video', 'tutorial', 'how to', 'review', 'unboxing', 'trailer', 'movie'];
    if (videoKeywords.some(k => lower.includes(k))) {
        features.videoResults = true;
        details.videoCount = Math.floor(Math.random() * 3) + 1;
    }
    
    // Shopping/Product
    const shopKeywords = ['buy', 'price', 'cost', 'best', 'top 10', 'review', 'amazon', 'flipkart'];
    if (shopKeywords.some(k => lower.includes(k))) {
        features.shoppingResults = true;
        details.shoppingAds = Math.floor(Math.random() * 4) + 2;
    }
    
    // Knowledge graph
    const kgKeywords = ['who is', 'who was', 'what is', 'when was', 'where is', 'population', 'height', 'age'];
    if (kgKeywords.some(k => lower.includes(k))) {
        features.knowledgeGraph = true;
    }
    
    // Job listings
    if (lower.includes('jobs') || lower.includes('careers') || lower.includes('hiring')) {
        features.jobListing = true;
    }
    
    // Events
    const eventKeywords = ['event', 'conference', 'workshop', 'seminar', '2024', '2025'];
    if (eventKeywords.some(k => lower.includes(k))) {
        features.eventListing = true;
    }
    
    // Count detected features
    const detectedFeatures = Object.entries(features).filter(([k, v]) => v === true).map(([k]) => k);
    
    // Calculate rich results opportunity
    const richOpportunity = detectedFeatures.length === 0 ? 'high' : 
                           detectedFeatures.length <= 2 ? 'medium' : 'low';
    
    return {
        features,
        details,
        competition: features.featuredSnippet || features.peopleAlsoAsk ? 'high' : 'medium',
        richOpportunity,
    };
}

// ─── Calculate Opportunity Score ───
function calculateOpportunityScore(volumeData, serpResults, intent, serpFeatures) {
    let score = 0;
    
    // Volume factor (0-30)
    if (volumeData.volume >= 5000) score += 30;
    else if (volumeData.volume >= 1000) score += 20;
    else if (volumeData.volume >= 500) score += 10;
    else if (volumeData.volume >= 100) score += 5;
    
    // Difficulty factor (0-25) - lower difficulty = higher opportunity
    if (volumeData.difficulty <= 30) score += 25;
    else if (volumeData.difficulty <= 50) score += 15;
    else if (volumeData.difficulty <= 70) score += 10;
    else score += 5;
    
    // Competition factor (0-20)
    if (volumeData.competition === 'low') score += 20;
    else if (volumeData.competition === 'medium') score += 12;
    else score += 5;
    
    // CPC factor (0-15) - higher CPC = more commercial value
    if (volumeData.cpc >= 3) score += 15;
    else if (volumeData.cpc >= 1) score += 10;
    else if (volumeData.cpc >= 0.5) score += 5;
    
    // Intent factor (0-10)
    if (intent?.primary === 'transactional') score += 10;
    else if (intent?.primary === 'commercial') score += 7;
    else if (intent?.primary === 'navigational') score += 5;
    
    // SERP feature opportunity (0-10)
    if (serpFeatures?.richOpportunity === 'high') score += 10;
    else if (serpFeatures?.richOpportunity === 'medium') score += 5;
    
    // Normalize to 0-100
    return Math.min(100, Math.max(0, score));
}

// ─── Analyze Content Gaps ───
function analyzeContentGaps(serpResults) {
    const questions = [];
    const topics = new Set();
    const headings = [];
    
    // Extract questions from SERP titles and descriptions
    serpResults.forEach(result => {
        const title = String(result.title);
        const description = String(result.description);
        
        // Extract questions
        const questionMatches = (title + ' ' + description).match(/[¿⸮?]?\w+\s+\w+\s+\w+\s+\w+\s*\?/g);
        if (questionMatches) {
            questionMatches.forEach(q => {
                const cleanQ = q.replace(/^[¿⸮?]\s*/, '').trim();
                if (cleanQ.length > 10 && cleanQ.length < 150 && !questions.includes(cleanQ)) {
                    questions.push(cleanQ);
                }
            });
        }
        
        // Extract topics from titles
        const words = title.toLowerCase().split(/\s+/);
        words.forEach(word => {
            if (word.length > 4 && !['about', 'with', 'from', 'what', 'your', 'best', 'top'].includes(word)) {
                topics.add(word);
            }
        });
    });
    
    // Identify missing elements based on common SEO best practices
    const missingElements = [];
    
    // Check if FAQ schema opportunity exists
    if (questions.length >= 3) {
        missingElements.push({
            element: 'FAQ Schema',
            reason: 'Multiple questions detected - FAQ schema can win PAA boxes',
            impact: 'high',
        });
    }
    
    // Check for listicle opportunity
    const topWords = ['best', 'top', '10', 'review'];
    const hasListicle = serpResults.slice(0, 5).some(r => 
        topWords.some(w => String(r.title).toLowerCase().includes(w))
    );
    if (hasListicle) {
        missingElements.push({
            element: 'Comparison Table',
            reason: 'Top results are listicles - a comparison table can differentiate',
            impact: 'medium',
        });
    }
    
    return {
        questions: questions.slice(0, 8),
        topics: Array.from(topics).slice(0, 15),
        targetLength: Math.max(1500, serpResults.slice(0, 3).length * 800),
        missingElements,
    };
}

// ─── Analyze Top Pages ───
async function analyzeTopPages(serpResults) {
    const analyses = [];
    
    for (const result of serpResults) {
        try {
            const analysis = await analyzePageContent(result.url, '');
            analyses.push({
                url: result.url,
                domain: result.domain,
                wordCount: analysis.wordCount,
                hasH1: analysis.seoElements.hasH1,
                hasMeta: analysis.seoElements.hasMetaDescription,
                headingCount: analysis.seoElements.headings?.h2 || 0,
            });
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            log.debug({ url: result.url }, 'page analysis failed');
        }
    }
    
    if (analyses.length === 0) {
        return {
            avgWordCount: 0,
            commonHeadings: [],
            avgDA: 0,
            recommendations: [],
        };
    }
    
    const avgWordCount = Math.round(analyses.reduce((sum, a) => sum + a.wordCount, 0) / analyses.length);
    const avgH2 = Math.round(analyses.reduce((sum, a) => sum + a.headingCount, 0) / analyses.length);
    
    const recommendations = [];
    
    if (avgWordCount < 1000) {
        recommendations.push({
            type: 'content_length',
            message: `Competitors average ${avgWordCount} words. Target at least ${Math.round(avgWordCount * 1.2)} words.`,
            priority: 'high',
        });
    }
    
    if (avgH2 < 5) {
        recommendations.push({
            type: 'headings',
            message: `Add ${10 - avgH2} more H2 headings to match competitor structure.`,
            priority: 'medium',
        });
    }
    
    return {
        avgWordCount,
        avgH2Count: avgH2,
        commonHeadings: extractCommonHeadings(analyses),
        avgDA: 0,
        recommendations,
    };
}

// ─── Extract Common Headings ───
function extractCommonHeadings(analyses) {
    const headingPatterns = [
        'Introduction', 'Features', 'Benefits', 'Pricing', 'FAQ',
        'How It Works', 'Reviews', 'Comparison', 'Conclusion',
        'Services', 'About', 'Contact', 'Testimonials', 'Case Studies',
    ];
    
    return headingPatterns.filter(h => 
        analyses.some(a => a.url && a.url.toLowerCase().includes(h.toLowerCase()))
    );
}

// ─── Compare Across Locations ───
async function compareAcrossLocations(keyword, locations) {
    const results = [];
    
    for (const loc of locations) {
        try {
            const volumeData = await estimateSearchVolume(keyword, loc);
            const serpResults = await getSERPResults(keyword, loc, 5);
            const intent = analyzeKeywordIntent(keyword);
            
            results.push({
                location: loc,
                searchVolume: volumeData.volume,
                competition: volumeData.competition,
                topDomains: serpResults.slice(0, 3).map(r => r.domain),
                localCompetitors: serpResults.filter(r => 
                    loc.toLowerCase().includes(r.domain.split('.')[0])
                ).length,
            });
            
            await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
            log.debug({ location: loc }, 'location comparison failed');
        }
    }
    
    return {
        locations: results,
        bestLocation: results.sort((a, b) => b.searchVolume - a.searchVolume)[0]?.location || null,
        insights: generateLocationInsights(results),
    };
}

// ─── Generate Location Insights ───
function generateLocationInsights(results) {
    if (results.length < 2) return [];
    
    const insights = [];
    const maxVolume = Math.max(...results.map(r => r.searchVolume));
    const maxLocal = Math.max(...results.map(r => r.localCompetitors));
    
    results.forEach(r => {
        if (r.searchVolume === maxVolume) {
            insights.push(`${r.location} has the highest search volume (${r.searchVolume}).`);
        }
        if (r.localCompetitors > 2) {
            insights.push(`${r.location} has strong local competition (${r.localCompetitors} local sites).`);
        }
    });
    
    return insights;
}

// ─── Helper Functions ───
function formatLocationDisplay(config) {
    if (config.area) return `${config.area}, ${config.city}, ${config.state}, ${config.country}`;
    if (config.city) return `${config.city}, ${config.state || config.country}`;
    return config.country || config.google;
}

function estimateCPCRange(competition, intent) {
    let min = 0.1;
    let max = 1.0;
    
    if (competition === 'high') { min = 1.0; max = 5.0; }
    else if (competition === 'medium') { min = 0.5; max = 2.5; }
    
    if (intent?.primary === 'transactional') { min *= 1.5; max *= 1.5; }
    else if (intent?.primary === 'commercial') { min *= 1.2; max *= 1.2; }
    
    return {
        min: parseFloat(min.toFixed(2)),
        max: parseFloat(max.toFixed(2)),
    };
}

function getIntentDescription(intent) {
    const descriptions = {
        informational: 'Users are looking for information/answers. Best for blog content, guides, and educational material.',
        navigational: 'Users are looking for a specific website/brand. Best for branded campaigns and claiming your brand terms.',
        commercial: 'Users are researching before buying. Best for comparison pages, reviews, and buying guides.',
        transactional: 'Users are ready to buy/take action. Best for product pages, landing pages, and CTAs.',
    };
    return descriptions[intent] || '';
}

module.exports = {
    estimateSearchVolume,
    getSERPResults,
    analyzePageContent,
    getDomainAuthority,
    extractDomain,
    getKeywordSuggestions,
    advancedKeywordResearch,
    analyzeKeywordIntent,
    detectSERPFeatures,
};
