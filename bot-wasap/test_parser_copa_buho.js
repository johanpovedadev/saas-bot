#!/usr/bin/env node
'use strict';

/**
 * TEST: Parser Determinista - "2 copa buho"
 * 
 * Valida que el parser detecte correctamente productos con múltiples palabras
 * y asigne alta confianza (>= 0.9) para que se agreguen automáticamente al carrito.
 */

const { parseOrderText } = require('./services/parseOrderText');

console.log('\n=== TEST: Parser Determinista - Copa Búho ===\n');

const testCases = [
    {
        input: '2 copa buho',
        expected: {
            quantity: 2,
            product_name: 'copa buho',
            minConfidence: 0.9
        }
    },
    {
        input: '1 copa gusanito',
        expected: {
            quantity: 1,
            product_name: 'copa gusanito',
            minConfidence: 0.9
        }
    },
    {
        input: '3 volcan de chocolate',
        expected: {
            quantity: 3,
            product_name: 'volcan chocolate',
            minConfidence: 0.9
        }
    },
    {
        input: '2 copa buho sin toppings',
        expected: {
            quantity: 2,
            product_name: 'copa buho',
            minConfidence: 0.9,
            toppings: []
        }
    },
    {
        input: '1 buho',
        expected: {
            quantity: 1,
            product_name: 'buho',
            minConfidence: 0.9
        }
    }
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const result = parseOrderText(testCase.input);
    
    console.log(`\n📝 Input: "${testCase.input}"`);
    console.log(`Expected:`, testCase.expected);
    console.log(`Got:`, result);
    
    let testPassed = true;
    const errors = [];
    
    // Validate quantity
    if (result.parsed.quantity !== testCase.expected.quantity) {
        testPassed = false;
        errors.push(`❌ Quantity: expected ${testCase.expected.quantity}, got ${result.parsed.quantity}`);
    }
    
    // Validate product_name
    if (result.parsed.product_name !== testCase.expected.product_name) {
        testPassed = false;
        errors.push(`❌ Product: expected "${testCase.expected.product_name}", got "${result.parsed.product_name}"`);
    }
    
    // Validate confidence
    if (result.confidence < testCase.expected.minConfidence) {
        testPassed = false;
        errors.push(`❌ Confidence: expected >= ${testCase.expected.minConfidence}, got ${result.confidence}`);
    }
    
    // Validate toppings if specified
    if (testCase.expected.toppings !== undefined) {
        const hasToppings = Array.isArray(result.parsed.toppings) && result.parsed.toppings.length === 0;
        if (!hasToppings) {
            testPassed = false;
            errors.push(`❌ Toppings: expected [], got ${JSON.stringify(result.parsed.toppings)}`);
        }
    }
    
    if (testPassed) {
        console.log(`✅ PASS - Confidence: ${result.confidence}`);
        passed++;
    } else {
        console.log(`❌ FAIL`);
        errors.forEach(err => console.log(`   ${err}`));
        failed++;
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 RESULTADOS: ${passed}/${testCases.length} tests pasados`);
if (failed > 0) {
    console.log(`⚠️  ${failed} tests fallaron`);
    process.exit(1);
} else {
    console.log(`✅ Todos los tests pasaron!`);
    process.exit(0);
}
