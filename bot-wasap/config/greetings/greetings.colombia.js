/**
 * Saludos Colombianos - Todas las variantes regionales
 * 
 * Este archivo contiene todos los saludos usados en Colombia
 * para que el bot responda de manera consistente.
 * 
 * @module greetings.colombia
 */

/**
 * Saludos formales e informales de Colombia
 * Incluye variantes regionales de todas las zonas del país
 */
const COLOMBIAN_GREETINGS = [
    // ===== SALUDOS FORMALES =====
    'hola',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'buen dia',
    'buen día',
    'buena tarde',
    'buena noche',
    
    // ===== SALUDOS INFORMALES GENERALES =====
    'buenas',
    'que mas',
    'qué más',
    'que hubo',
    'qué hubo',
    'como estas',
    'cómo estás',
    'como esta',
    'cómo está',
    'todo bien',
    'como te va',
    'cómo te va',
    'como le va',
    'cómo le va',
    
    // ===== COSTA CARIBE (Barranquilla, Cartagena, Santa Marta, Riohacha) =====
    'quiubo',
    'qui hubo',
    'quiubole',
    'qui ub',
    'quiúbole',
    'que ub',
    'epa',
    'epale',
    'epa que mas',
    'quiubo parce',
    'quiubo mi llave',
    'que mas pues',
    'ey',
    'eeey',
    'oye',
    'oiste',
    'oíste',
    'veci',
    'vecina',
    'vecino',
    'manito',
    'manita',
    'compae',
    'compa',
    'compadre',
    'comadre',
    
    // ===== ANTIOQUIA Y PAISA (Medellín, Manizales, Pereira) =====
    'alo',
    'aló',
    'oe',
    'oee',
    'oiga pues',
    'vea pues',
    'quiubo parce',
    'quiubo parcero',
    'que mas pues',
    'qué más pues',
    'que hubo pues',
    'bien o que',
    'bien o qué',
    'todo bien o que',
    'a las buenas',
    'sumercé',
    'su merced',
    
    // ===== BOGOTÁ Y CUNDINAMARCA =====
    'buenas buenas',
    'hola como estas',
    'hola cómo estás',
    'que pena',
    'qué pena',
    'como va todo',
    'cómo va todo',
    'saludos',
    'un saludo',
    
    // ===== VALLE DEL CAUCA (Cali, Palmira) =====
    'ey jugador',
    'ey jugadora',
    'ave maria',
    'avemaria',
    'ave maría',
    'mi amor',
    'mi vida',
    'mijo',
    'mija',
    'mi reina',
    'mi rey',
    'socio',
    'socia',
    
    // ===== SANTANDERES (Bucaramanga, Cúcuta) =====
    'eeey',
    'mi vale',
    'valeee',
    'corito',
    'corita',
    
    // ===== LLANOS ORIENTALES =====
    'eepa',
    'eeepaa',
    'hola corocoro',
    'mi llanero',
    'mi llanera',
    
    // ===== VARIANTES CON EMOTICONES/LENGUAJE DIGITAL =====
    'holaa',
    'holaaa',
    'holi',
    'holii',
    'holiii',
    'holiiii',
    'holaaaa',
    'hola!',
    'hola!!',
    'holaa!',
    'buenass',
    'buenasss',
    
    // ===== SALUDOS CORTOS/JERGA JOVEN =====
    'ey',
    'eyyy',
    'eyy',
    'we',
    'wey',
    'bro',
    'brother',
    'sis',
    'sister',
    'pa',
    'papa',
    'papá',
    'ma',
    'mama',
    'mamá',
    'tio',
    'tía',
    'primo',
    'prima',
    
    // ===== SALUDOS REGIONALES ESPECÍFICOS =====
    'ombe',
    'hombe',
    'hombremita',
    'mijo',
    'mijito',
    'mijita',
    'chino',
    'china',
    'pelao',
    'pelada',
    'man',
    'mani',
    'parcerito',
    'parcerita',
    'llave',
    'mi llave',
    'llaverito',
    
    // ===== EXPRESIONES DE INICIO DE CONVERSACIÓN =====
    'alo',
    'aló',
    'diga',
    'dígame',
    'a la orden',
    'ordene',
    'mande',
    'a sus ordenes',
    'a sus órdenes',
    
    // ===== VARIANTES CON ERRORES ORTOGRÁFICOS COMUNES =====
    'ola',
    'olaaa',
    'kien',
    'quien',
    'qien',
    'q mas',
    'k mas',
    'q hubo',
    'k hubo',
    'kiubo',
    'kiubole',
    
    // ===== SALUDOS DE WHATSAPP/MENSAJERÍA =====
    'hey',
    'heey',
    'heeey',
    'hi',
    'hello',
    'buenas vibras',
    'buena energía',
    'bendiciones',
    'bendicion',
    'bendición',
    
    // ===== SALUDOS SEGÚN HORA DEL DÍA =====
    'feliz mañana',
    'feliz tarde',
    'feliz noche',
    'linda mañana',
    'linda tarde',
    'linda noche',
    'bello día',
    'hermoso día',
];

/**
 * Normaliza un texto para comparación de saludos
 * Elimina acentos, convierte a minúsculas y elimina espacios extras
 * 
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeGreeting(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
        .replace(/[¿?¡!.,;:]/g, '') // Eliminar puntuación
        .replace(/\s+/g, ' '); // Normalizar espacios
}

/**
 * Verifica si un mensaje es un saludo
 * 
 * @param {string} message - Mensaje a verificar
 * @returns {boolean} True si es un saludo
 */
function isGreeting(message) {
    if (!message || typeof message !== 'string') return false;
    
    const normalized = normalizeGreeting(message);
    
    // Verificar coincidencia exacta
    if (COLOMBIAN_GREETINGS.some(greeting => normalizeGreeting(greeting) === normalized)) {
        return true;
    }
    
    // Verificar si el mensaje COMIENZA con un saludo
    const words = normalized.split(' ');
    const firstTwoWords = words.slice(0, 2).join(' ');
    const firstWord = words[0];
    
    return COLOMBIAN_GREETINGS.some(greeting => {
        const normalizedGreeting = normalizeGreeting(greeting);
        return firstWord === normalizedGreeting || firstTwoWords === normalizedGreeting;
    });
}

/**
 * Obtiene el saludo que coincide con el mensaje
 * 
 * @param {string} message - Mensaje a analizar
 * @returns {string|null} Saludo encontrado o null
 */
function getMatchingGreeting(message) {
    if (!isGreeting(message)) return null;
    
    const normalized = normalizeGreeting(message);
    
    // Buscar coincidencia exacta primero
    const exactMatch = COLOMBIAN_GREETINGS.find(
        greeting => normalizeGreeting(greeting) === normalized
    );
    
    if (exactMatch) return exactMatch;
    
    // Buscar por inicio de frase
    const words = normalized.split(' ');
    const firstTwoWords = words.slice(0, 2).join(' ');
    const firstWord = words[0];
    
    return COLOMBIAN_GREETINGS.find(greeting => {
        const normalizedGreeting = normalizeGreeting(greeting);
        return firstWord === normalizedGreeting || firstTwoWords === normalizedGreeting;
    });
}

/**
 * Obtiene estadísticas de saludos
 * 
 * @returns {Object} Estadísticas
 */
function getGreetingsStats() {
    return {
        total: COLOMBIAN_GREETINGS.length,
        unique: [...new Set(COLOMBIAN_GREETINGS.map(normalizeGreeting))].length,
        categories: {
            formal: 9,
            informal: 14,
            costaCaribe: 29,
            paisa: 16,
            bogota: 9,
            valleCauca: 13,
            santanderes: 5,
            llanos: 4,
            digital: 10,
            jerga: 19,
            regional: 15,
            inicio: 10,
            errores: 10,
            whatsapp: 11,
            horario: 9
        }
    };
}

// Exportar funciones y datos
module.exports = {
    COLOMBIAN_GREETINGS,
    isGreeting,
    getMatchingGreeting,
    normalizeGreeting,
    getGreetingsStats
};
