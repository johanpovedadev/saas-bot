/**
 * Test de integración: Saludos en Handler
 * Ejecutar con: node test_greetings_integration.js
 */

const { isGreeting } = require('./config/greetings/greetings.colombia');

console.log('🧪 Probando integración de saludos...\n');

// Test cases
const testCases = [
    { input: 'hola', shouldMatch: true },
    { input: 'quiubo parce', shouldMatch: true },
    { input: 'epa que mas', shouldMatch: true },
    { input: 'buenos días', shouldMatch: true },
    { input: 'menu', shouldMatch: false },
    { input: 'carrito', shouldMatch: false },
    { input: '1', shouldMatch: false },
];

let passed = 0;
let failed = 0;

testCases.forEach(test => {
    const result = isGreeting(test.input);
    const isCorrect = result === test.shouldMatch;
    
    if (isCorrect) {
        console.log(`✅ "${test.input}" → ${result ? 'Saludo' : 'No saludo'}`);
        passed++;
    } else {
        console.log(`❌ "${test.input}" → Esperado: ${test.shouldMatch}, Obtenido: ${result}`);
        failed++;
    }
});

console.log(`\n📊 Resultados: ${passed}/${testCases.length} tests pasados`);

if (failed === 0) {
    console.log('✅ ¡Integración de saludos funcionando correctamente!\n');
    process.exit(0);
} else {
    console.log(`❌ ${failed} tests fallaron\n`);
    process.exit(1);
}
