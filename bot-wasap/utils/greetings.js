/**
 * Módulo de Reconocimiento de Saludos Colombianos
 * 
 * Detecta saludos informales, regionales y formales para mejorar
 * la experiencia del usuario con respuestas naturales y cercanas.
 */

const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Patrones de saludos organizados por categorías
 */
const SALUDOS = {
    // Saludos informales comunes
    informales: [
        'hola', 'ola', 'hol', 'holaa', 'holaaa', 'holaaaa',
        'hl', 'hla', 'oli', 'olis',
        'hey', 'hei', 'heey', 'hi',
        'saludos', 'saludo'
    ],
    
    // Variantes de "buenas"
    buenas: [
        'buenas', 'bnas', 'bns', 'buena',
        'buenos dias', 'buen dia', 'buenos días', 'buen día',
        'buenas tardes', 'buena tarde',
        'buenas noches', 'buena noche'
    ],
    
    // Saludos coloquiales colombianos
    coloquiales: [
        'q hubo', 'qubo', 'kubo', 'que hubo',
        'q mas', 'que mas', 'q más', 'qué más', 'que más',
        'q mas k', 'que mas ke',
        'q tal', 'que tal', 'qué tal'
    ],
    
    // Saludos regionales - Paisa (Antioquia/Eje Cafetero)
    paisa: [
        'que mas pues', 'q mas pues', 'qué más pues',
        'bien o que', 'bien o qué', 'bien o no',
        'parce', 'parcero', 'parcerito'
    ],
    
    // Saludos regionales - Costeño (Costa Caribe)
    costeno: [
        'aja y que', 'ajá y qué', 'aja',
        'todo bien', 'todo bn',
        'habla', 'habla pues',
        'que cuentas', 'qué cuentas'
    ],
    
    // Saludos regionales - Caleño (Valle del Cauca)
    caleno: [
        'mira que mas', 'mirá qué más', 'mira',
        'ois', 'oís', 'ois que tal'
    ],
    
    // Saludos regionales - Bogotano/Andino
    bogotano: [
        'como te ha ido', 'cómo te ha ido',
        'que hay de nuevo', 'qué hay de nuevo',
        'como estas', 'cómo estás', 'como está'
    ],
    
    // Saludos regionales - Santandereano
    santandereano: [
        'que mas mano', 'qué más mano',
        'como va la joda', 'cómo va la joda'
    ]
};

/**
 * Normaliza texto para comparación (minúsculas, sin tildes, sin puntuación)
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Eliminar tildes
        .replace(/[¿?¡!.,;:]/g, '') // Eliminar puntuación
        .trim();
}

/**
 * Detecta si un mensaje es un saludo
 * @param {string} message - Mensaje del usuario
 * @returns {boolean} true si es un saludo
 */
function isGreeting(message) {
    const normalized = normalizeText(message);
    
    // Buscar en todas las categorías de saludos
    for (const category of Object.values(SALUDOS)) {
        for (const greeting of category) {
            const normalizedGreeting = normalizeText(greeting);
            
            // Coincidencia exacta o al inicio de la frase
            if (normalized === normalizedGreeting || 
                normalized.startsWith(normalizedGreeting + ' ') ||
                normalized.endsWith(' ' + normalizedGreeting)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Detecta el tipo/región del saludo para personalizar la respuesta
 * @param {string} message - Mensaje del usuario
 * @returns {string|null} Tipo de saludo detectado ('paisa', 'costeno', etc.) o null
 */
function getGreetingType(message) {
    const normalized = normalizeText(message);
    
    // Priorizar saludos regionales para respuestas personalizadas
    const categories = [
        'paisa',
        'costeno',
        'caleno',
        'bogotano',
        'santandereano',
        'coloquiales',
        'buenas',
        'informales'
    ];
    
    for (const category of categories) {
        const greetings = SALUDOS[category];
        if (greetings) {
            for (const greeting of greetings) {
                const normalizedGreeting = normalizeText(greeting);
                if (normalized === normalizedGreeting || 
                    normalized.startsWith(normalizedGreeting + ' ') ||
                    normalized.endsWith(' ' + normalizedGreeting)) {
                    return category;
                }
            }
        }
    }
    
    return null;
}

/**
 * Obtiene un mensaje de bienvenida personalizado según el tipo de saludo
 * @param {string} greetingType - Tipo de saludo detectado
 * @returns {string} Mensaje de bienvenida personalizado
 */
function getWelcomeMessage(greetingType = 'informales') {
    const messages = {
        paisa: `¡Qué más, pues! ☺️
¡Bienvenido a Mundo Helados! 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        costeno: `¡Ajá! ¿Todo bien? 🌴
¡Bienvenido a Mundo Helados! 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        caleno: `¡Ey, qué más! 😎
¡Bienvenido a Mundo Helados! 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        bogotano: `¡Hola! ¿Cómo estás? ☺️
¡Bienvenido a Mundo Helados! 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        santandereano: `¡Qué más, mano! 👋
¡Bienvenido a Mundo Helados! 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        coloquiales: `¡Hola! 😊
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        buenas: `¡Buenas! ☺️
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`,
        
        informales: `Holiii ☺️
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe el número de la opción (1, 2 o 3).`
    };
    
    return messages[greetingType] || messages.informales;
}

/**
 * Detecta si el mensaje contiene solo un saludo (sin otra información)
 * @param {string} message - Mensaje del usuario
 * @returns {boolean} true si es solo un saludo
 */
function isOnlyGreeting(message) {
    const normalized = normalizeText(message);
    const words = normalized.split(/\s+/).filter(Boolean);
    
    // Si tiene más de 3 palabras, probablemente no es solo un saludo
    if (words.length > 3) return false;
    
    // Verificar si todas las palabras son parte de saludos conocidos
    const allGreetingWords = new Set();
    for (const category of Object.values(SALUDOS)) {
        for (const greeting of category) {
            const greetingWords = normalizeText(greeting).split(/\s+/);
            greetingWords.forEach(word => allGreetingWords.add(word));
        }
    }
    
    // Palabras comunes en saludos que no necesariamente son saludos por sí solas
    const commonWords = new Set(['y', 'o', 'a', 'de', 'que', 'mas', 'pues', 'bien', 'todo']);
    
    return words.every(word => allGreetingWords.has(word) || commonWords.has(word));
}

/**
 * Maneja un saludo y retorna el mensaje de bienvenida apropiado
 * @param {string} message - Mensaje del usuario
 * @returns {Object} { isGreeting: boolean, welcomeMessage: string|null, greetingType: string|null }
 */
function handleGreeting(message) {
    if (!isGreeting(message)) {
        return {
            isGreeting: false,
            welcomeMessage: null,
            greetingType: null
        };
    }
    
    // Solo responder con menú completo si es SOLO un saludo
    if (!isOnlyGreeting(message)) {
        return {
            isGreeting: true,
            welcomeMessage: null, // El mensaje tiene más información, no enviar menú
            greetingType: getGreetingType(message)
        };
    }
    
    const greetingType = getGreetingType(message);
    const welcomeMessage = getWelcomeMessage(greetingType);
    
    logger.info(`Saludo detectado - Tipo: ${greetingType || 'genérico'}`);
    
    return {
        isGreeting: true,
        welcomeMessage,
        greetingType
    };
}

module.exports = {
    isGreeting,
    getGreetingType,
    getWelcomeMessage,
    isOnlyGreeting,
    handleGreeting,
    normalizeText,
    SALUDOS
};
