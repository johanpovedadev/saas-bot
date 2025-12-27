/**
 * Test Suite para Saludos Colombianos
 * Ejecutar con: node test_greetings.js
 */

const { 
    COLOMBIAN_GREETINGS, 
    isGreeting, 
    getMatchingGreeting,
    normalizeGreeting,
    getGreetingsStats 
} = require('./config/greetings/greetings.colombia');

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

// Contadores
let testsPassed = 0;
let testsFailed = 0;
let testsTotal = 0;

/**
 * Función de aserción mejorada
 */
function assert(condition, testName, expected, actual) {
    testsTotal++;
    if (condition) {
        console.log(`${colors.green}✅ PASS${colors.reset}: ${testName}`);
        testsPassed++;
        return true;
    } else {
        console.log(`${colors.red}❌ FAIL${colors.reset}: ${testName}`);
        if (expected !== undefined) {
            console.log(`   ${colors.yellow}Expected:${colors.reset}`, expected);
            console.log(`   ${colors.yellow}Actual:${colors.reset}`, actual);
        }
        testsFailed++;
        return false;
    }
}

/**
 * Separador visual
 */
function separator(title) {
    console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.cyan}${title}${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

// ==========================================
// TEST 1: Verificar cantidad de saludos
// ==========================================
separator('TEST 1: Cantidad de Saludos');

assert(
    COLOMBIAN_GREETINGS.length >= 150,
    'Debe haber al menos 150 saludos',
    '>=150',
    COLOMBIAN_GREETINGS.length
);

assert(
    COLOMBIAN_GREETINGS.length === 184,
    `Total de saludos debe ser 184`,
    184,
    COLOMBIAN_GREETINGS.length
);

// ==========================================
// TEST 2: Saludos Formales
// ==========================================
separator('TEST 2: Saludos Formales');

const formalGreetings = [
    'hola',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'buen día'
];

formalGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" debe ser reconocido como saludo`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 3: Saludos Costa Caribe
// ==========================================
separator('TEST 3: Saludos Costa Caribe (Riohacha, Barranquilla, Cartagena)');

const coastalGreetings = [
    'quiubo',
    'epa',
    'epale',
    'quiubo parce',
    'que mas pues',
    'epa que mas',
    'quiubo mi llave'
];

coastalGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" (Costa Caribe) debe ser reconocido`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 4: Saludos Paisas
// ==========================================
separator('TEST 4: Saludos Paisas (Medellín, Manizales)');

const paisaGreetings = [
    'oe',
    'quiubo parcero',
    'que mas pues',
    'bien o que',
    'vea pues'
];

paisaGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" (Paisa) debe ser reconocido`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 5: Saludos Caleños
// ==========================================
separator('TEST 5: Saludos Valle del Cauca (Cali)');

const caliGreetings = [
    'ey jugador',
    'ave maria',
    'mi amor',
    'socio',
    'mi rey'
];

caliGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" (Cali) debe ser reconocido`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 6: Variantes con acentos
// ==========================================
separator('TEST 6: Normalización de Acentos');

const accentTests = [
    { with: 'qué más', without: 'que mas' },
    { with: 'cómo estás', without: 'como estas' },
    { with: 'aló', without: 'alo' },
    { with: 'quiúbole', without: 'quiubole' }
];

accentTests.forEach(test => {
    const normalized1 = normalizeGreeting(test.with);
    const normalized2 = normalizeGreeting(test.without);
    assert(
        normalized1 === normalized2,
        `"${test.with}" y "${test.without}" deben normalizarse igual`,
        normalized2,
        normalized1
    );
});

// ==========================================
// TEST 7: Errores ortográficos comunes
// ==========================================
separator('TEST 7: Errores Ortográficos Comunes');

const typoGreetings = [
    'ola',
    'kiubo',
    'q mas',
    'k hubo',
    'kiubole'
];

typoGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" (error ortográfico común) debe ser reconocido`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 8: Variantes digitales
// ==========================================
separator('TEST 8: Variantes Digitales/WhatsApp');

const digitalGreetings = [
    'holaa',
    'holaaa',
    'holiii',
    'hola!',
    'hola!!',
    'buenass',
    'hey',
    'heey'
];

digitalGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" (digital) debe ser reconocido`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 9: Saludos compuestos
// ==========================================
separator('TEST 9: Saludos Compuestos (con contexto)');

const compositeGreetings = [
    'hola como estas',
    'epa que mas',
    'quiubo parce como vas',
    'buenos días me interesa un producto'
];

compositeGreetings.forEach(greeting => {
    assert(
        isGreeting(greeting),
        `"${greeting}" debe ser reconocido como saludo`,
        true,
        isGreeting(greeting)
    );
});

// ==========================================
// TEST 10: NO saludos (casos negativos)
// ==========================================
separator('TEST 10: Casos Negativos (NO son saludos)');

const nonGreetings = [
    'menu',
    'carrito',
    'pagar',
    '123',
    'producto',
    'cuanto cuesta',
    'direccion',
    's1 s2',
    't1',
    '2'
];

nonGreetings.forEach(text => {
    assert(
        !isGreeting(text),
        `"${text}" NO debe ser reconocido como saludo`,
        false,
        isGreeting(text)
    );
});

// ==========================================
// TEST 11: getMatchingGreeting()
// ==========================================
separator('TEST 11: Función getMatchingGreeting()');

const matchTests = [
    { input: 'hola', expected: 'hola' },
    { input: 'HOLA', expected: 'hola' },
    { input: 'Hola!!', expected: 'hola' },
    { input: 'quiubo parce', expected: 'quiubo parce' },
    { input: 'epa que mas', expected: 'epa' }, // Match por inicio
];

matchTests.forEach(test => {
    const match = getMatchingGreeting(test.input);
    assert(
        match !== null,
        `getMatchingGreeting("${test.input}") debe retornar un saludo`,
        'not null',
        match
    );
});

// ==========================================
// TEST 12: Normalización compleja
// ==========================================
separator('TEST 12: Normalización Compleja');

const complexNormalizations = [
    { input: '¡Hola!', expected: 'hola' },
    { input: '¿Qué más?', expected: 'que mas' },
    { input: '   hola   ', expected: 'hola' },
    { input: 'HOLAAAA!!!', expected: 'holaaaa' }
];

complexNormalizations.forEach(test => {
    const normalized = normalizeGreeting(test.input);
    assert(
        normalized === test.expected,
        `normalizeGreeting("${test.input}") debe ser "${test.expected}"`,
        test.expected,
        normalized
    );
});

// ==========================================
// TEST 13: Estadísticas
// ==========================================
separator('TEST 13: Estadísticas de Saludos');

const stats = getGreetingsStats();

assert(
    stats.total === 184,
    'Total de saludos en estadísticas',
    184,
    stats.total
);

assert(
    stats.unique >= 150,
    'Saludos únicos (sin duplicados)',
    '>=150',
    stats.unique
);

assert(
    typeof stats.categories === 'object',
    'Debe tener categorías definidas',
    'object',
    typeof stats.categories
);

console.log(`\n${colors.blue}📊 Estadísticas de Saludos:${colors.reset}`);
console.log(`   Total: ${stats.total}`);
console.log(`   Únicos: ${stats.unique}`);
console.log(`   Categorías:`, stats.categories);

// ==========================================
// TEST 14: Performance (1000 verificaciones)
// ==========================================
separator('TEST 14: Performance Test (1000 verificaciones)');

const startTime = Date.now();
for (let i = 0; i < 1000; i++) {
    isGreeting('hola');
    isGreeting('quiubo');
    isGreeting('que mas');
    isGreeting('menu'); // No es saludo
}
const endTime = Date.now();
const duration = endTime - startTime;

assert(
    duration < 300,
    `4000 verificaciones deben completarse en <300ms`,
    '<300ms',
    `${duration}ms`
);

// ==========================================
// TEST 15: Casos edge
// ==========================================
separator('TEST 15: Casos Edge (valores inválidos)');

assert(
    !isGreeting(null),
    'null no debe ser reconocido como saludo',
    false,
    isGreeting(null)
);

assert(
    !isGreeting(undefined),
    'undefined no debe ser reconocido como saludo',
    false,
    isGreeting(undefined)
);

assert(
    !isGreeting(''),
    'String vacío no debe ser reconocido como saludo',
    false,
    isGreeting('')
);

assert(
    !isGreeting(123),
    'Número no debe ser reconocido como saludo',
    false,
    isGreeting(123)
);

// ==========================================
// RESUMEN FINAL
// ==========================================
separator('RESUMEN FINAL');

const passRate = ((testsPassed / testsTotal) * 100).toFixed(2);
const status = testsPassed === testsTotal ? colors.green : colors.red;

console.log(`\n${colors.blue}📊 Resultados:${colors.reset}`);
console.log(`   ${colors.green}✅ Pasados: ${testsPassed}${colors.reset}`);
console.log(`   ${colors.red}❌ Fallados: ${testsFailed}${colors.reset}`);
console.log(`   📝 Total: ${testsTotal}`);
console.log(`   ${status}🎯 Tasa de éxito: ${passRate}%${colors.reset}\n`);

if (testsPassed === testsTotal) {
    console.log(`${colors.green}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.green}✅ ¡TODOS LOS TESTS PASARON! 🎉${colors.reset}`);
    console.log(`${colors.green}${'='.repeat(60)}${colors.reset}\n`);
    process.exit(0);
} else {
    console.log(`${colors.red}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.red}❌ ALGUNOS TESTS FALLARON${colors.reset}`);
    console.log(`${colors.red}${'='.repeat(60)}${colors.reset}\n`);
    process.exit(1);
}
