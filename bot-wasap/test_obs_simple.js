/**
 * Test simple del flujo de observaciones
 */

console.log('\n═══════════════════════════════════════════════');
console.log('  TEST: VALIDACIÓN DE OBSERVACIONES');
console.log('═══════════════════════════════════════════════\n');

// Simular la lógica de parseo del código
function testObservacionesLogic(input) {
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;
    const inputTokens = input.split(/\s+/);
    const toppingCodes = [];
    const observacionesParts = [];
    
    // Si el mensaje COMPLETO es solo "sin", "no", "nada" -> interpretarlo como "sin nada"
    const esSoloSinNada = noKeywordsRegex.test(input);
    
    if (!esSoloSinNada) {
        // Parsear token por token
        for (const token of inputTokens) {
            const trimmedToken = token.trim();
            // Si es código de topping (T1, T2, etc.)
            if (/^t\d+$/i.test(trimmedToken)) {
                toppingCodes.push(trimmedToken.toUpperCase());
            } 
            // Si NO es número, guardarlo como parte de observación (incluyendo "sin")
            else if (!/^\d+$/.test(trimmedToken)) {
                observacionesParts.push(token); // Mantener formato original
            }
        }
    }
    
    return {
        toppings: toppingCodes,
        observaciones: observacionesParts.join(' '),
        esSinNada: esSoloSinNada
    };
}

// Tests
const tests = [
    { input: 'sin papaya', expected: { toppings: [], observaciones: 'sin papaya', esSinNada: false } },
    { input: 'T1 sin papaya', expected: { toppings: ['T1'], observaciones: 'sin papaya', esSinNada: false } },
    { input: 'T1 T2 sin azúcar', expected: { toppings: ['T1', 'T2'], observaciones: 'sin azúcar', esSinNada: false } },
    { input: 'sin', expected: { toppings: [], observaciones: '', esSinNada: true } },
    { input: 'no', expected: { toppings: [], observaciones: '', esSinNada: true } },
    { input: 'sin cebolla', expected: { toppings: [], observaciones: 'sin cebolla', esSinNada: false } },
];

let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
    console.log(`\n📋 Test ${index + 1}: "${test.input}"`);
    console.log('─'.repeat(50));
    
    const result = testObservacionesLogic(test.input);
    
    console.log(`Resultado:`);
    console.log(`  Toppings: [${result.toppings.join(', ')}]`);
    console.log(`  Observaciones: "${result.observaciones}"`);
    console.log(`  Es "sin nada": ${result.esSinNada}`);
    
    const toppingsMatch = JSON.stringify(result.toppings) === JSON.stringify(test.expected.toppings);
    const observacionesMatch = result.observaciones === test.expected.observaciones;
    const esSinNadaMatch = result.esSinNada === test.expected.esSinNada;
    
    if (toppingsMatch && observacionesMatch && esSinNadaMatch) {
        console.log('✅ PASS');
        passed++;
    } else {
        console.log('❌ FAIL');
        console.log(`  Esperado:`);
        console.log(`    Toppings: [${test.expected.toppings.join(', ')}]`);
        console.log(`    Observaciones: "${test.expected.observaciones}"`);
        console.log(`    Es "sin nada": ${test.expected.esSinNada}`);
        failed++;
    }
});

console.log('\n═══════════════════════════════════════════════');
console.log(`  RESULTADO: ${passed} PASS, ${failed} FAIL`);
console.log('═══════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
