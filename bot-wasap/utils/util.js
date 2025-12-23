const axios = require('axios');
const CONFIG = require('../config.json');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizarMensaje(text) {
    if (typeof text !== 'string') return '';
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function money(number) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0
    }).format(number).replace('COP', '').trim();
}

function parsePrice(price) {
    if (typeof price === 'string') {
        const cleaned = price.replace(/[^0-9.]/g, '');
        return parseFloat(cleaned) || 0;
    }
    return parseFloat(price) || 0;
}

function parseProductAndQuantity(text) {
    const defaultQuantity = 1;
    const tokens = normalizarMensaje(text).split(' ');
    let quantity = defaultQuantity;
    let productName = text;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!isNaN(parseInt(token))) {
            quantity = parseInt(token);
            tokens.splice(i, 1);
            productName = tokens.join(' ');
            break;
        }
    }
    return { productName, quantity };
}

async function getDeliveryCost(address) {
    try {
        const response = await axios.get(CONFIG.API_BASE + '/' + CONFIG.ENDPOINTS.DELIVERY_COST, {
            params: { q: address },
            timeout: 10000 
        });

        if (response.data && response.data.costo) {
            return parsePrice(response.data.costo);
        } else {
            return null;
        }
    } catch (e) {
        console.error('Error al obtener costo de envío:', e.response?.data || e.message);
        return null;
    }
}

function isGreeting(t) {
    try {
        if (!t || typeof t !== 'string') return false;
        const s = normalizarMensaje(t);
        // Split into tokens keeping words
        const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);

        const greetings = ['hola', 'buenas', 'buenos dias', 'buenos días', 'buenosdías', 'buenosdias', 'buen dia', 'buen día', 'buenas tardes', 'buenas noches', 'hi', 'hey', 'hello', 'que mas', 'qué mas', 'qué hubo', 'q mas'];

        // small Levenshtein with early exit for performance
        function levenshteinLimited(a, b, maxDist = 1) {
            if (a === b) return 0;
            if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
            const m = a.length, n = b.length;
            const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++) dp[i][0] = i;
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++) {
                let rowMin = Infinity;
                for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
                    if (dp[i][j] < rowMin) rowMin = dp[i][j];
                }
                if (rowMin > maxDist) return maxDist + 1;
            }
            return dp[m][n];
        }

        for (const token of tokens) {
            // direct includes
            for (const g of greetings) {
                if (token.includes(g.replace(/\s+/g, '')) || g.includes(token)) return true;
                // fuzzy for short tokens (<=6 chars) to catch typos like 'hl', 'holla', 'holaa'
                if (token.length <= 6) {
                    const dist = levenshteinLimited(token, g.replace(/\s+/g, ''), 1);
                    if (dist <= 1) return true;
                }
            }
        }

        // Also catch phrases that start with greeting words
        const starts = ['hola', 'buen', 'buenos', 'buenas', 'hi', 'hey', 'hello', 'q', 'qué', 'que'];
        for (const st of starts) {
            if (s.startsWith(st)) return true;
        }

        return false;
    } catch (e) {
        console.warn('isGreeting error:', e && e.message ? e.message : e);
        return false;
    }
}

function wantsMenu(t) {
    const menuRequests = ['menu', 'catalogo', 'carta', 'productos', 'quiero comprar'];
    return menuRequests.some(request => t.includes(request));
}

module.exports = {
    sleep,
    normalizarMensaje,
    money,
    parsePrice,
    parseProductAndQuantity,
    getDeliveryCost,
    isGreeting,
    wantsMenu
};