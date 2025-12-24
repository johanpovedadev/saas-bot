/**
 * Test para el sistema de búsqueda fuzzy (tolerante a errores ortográficos)
 * 
 * Casos de prueba:
 * 1. Búsqueda de productos con errores ortográficos
 * 2. Búsqueda de sabores con errores ortográficos
 * 3. Búsqueda de toppings con errores ortográficos
 */

const {
    fuzzySearch,
    fuzzySearchProducts,
    fuzzySearchSabores,
    fuzzySearchToppings,
    similarityScore,
    levenshteinDistance
} = require('./utils/fuzzySearch');

console.log('🧪 Iniciando tests de búsqueda fuzzy...\n');

// Mock data
const productos = [
    { CodigoProducto: 'P001', NombreProducto: 'Copa de Helado', Precio_Venta: 5000 },
    { CodigoProducto: 'P002', NombreProducto: 'Paleta de Chocolate', Precio_Venta: 3000 },
    { CodigoProducto: 'P003', NombreProducto: 'Caja Familiar', Precio_Venta: 25000 },
    { CodigoProducto: 'P004', NombreProducto: 'Volcán de Fresa', Precio_Venta: 12000 },
    { CodigoProducto: 'P005', NombreProducto: 'Litro de Vainilla', Precio_Venta: 18000 }
];

const sabores = [
    { CodigoProducto: 'S001', NombreProducto: 'Vainilla', Precio_Venta: 0 },
    { CodigoProducto: 'S002', NombreProducto: 'Chocolate', Precio_Venta: 0 },
    { CodigoProducto: 'S003', NombreProducto: 'Fresa', Precio_Venta: 0 },
    { CodigoProducto: 'S004', NombreProducto: 'Arequipe', Precio_Venta: 0 },
    { CodigoProducto: 'S005', NombreProducto: 'Mora', Precio_Venta: 0 },
    { CodigoProducto: 'S006', NombreProducto: 'Lúcuma', Precio_Venta: 0 }
];

const toppings = [
    { CodigoProducto: 'T001', NombreProducto: 'Chispas de Chocolate', Precio_Venta: 500 },
    { CodigoProducto: 'T002', NombreProducto: 'Gomitas', Precio_Venta: 500 },
    { CodigoProducto: 'T003', NombreProducto: 'Nueces', Precio_Venta: 800 },
    { CodigoProducto: 'T004', NombreProducto: 'Malvaviscos', Precio_Venta: 600 }
];

let testsPass = 0;
let testsFail = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        testsPass++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        testsFail++;
    }
}

// Test 1: Distancia de Levenshtein
console.log('--- Test 1: Distancia de Levenshtein ---');
assert(levenshteinDistance('copa', 'copa') === 0, 'Distancia entre palabras idénticas debe ser 0');
assert(levenshteinDistance('copa', 'cpa') === 1, 'Distancia entre "copa" y "cpa" debe ser 1');
assert(levenshteinDistance('copa', 'coka') === 1, 'Distancia entre "copa" y "coka" debe ser 1');
assert(levenshteinDistance('vainilla', 'vainila') === 1, 'Distancia entre "vainilla" y "vainila" debe ser 1');

// Test 2: Score de similitud
console.log('\n--- Test 2: Score de Similitud ---');
const score1 = similarityScore('copa', 'copa');
const score2 = similarityScore('copa', 'cpa');
const score3 = similarityScore('copa', 'paleta');
assert(score1 === 1.0, `Similitud entre palabras idénticas debe ser 1.0 (obtenido: ${score1})`);
assert(score2 > 0.5, `Similitud entre "copa" y "cpa" debe ser > 0.5 (obtenido: ${score2})`);
assert(score3 < 0.5, `Similitud entre "copa" y "paleta" debe ser < 0.5 (obtenido: ${score3})`);

// Test 3: Búsqueda fuzzy de productos con errores ortográficos
console.log('\n--- Test 3: Búsqueda Fuzzy de Productos ---');

const result1 = fuzzySearchProducts('cpa', productos);
assert(result1.length > 0, 'Debe encontrar "Copa de Helado" al buscar "cpa"');
assert(result1[0].NombreProducto.includes('Copa'), `Primer resultado debe ser Copa (obtenido: ${result1[0]?.NombreProducto})`);

const result2 = fuzzySearchProducts('paletta', productos);
assert(result2.length > 0, 'Debe encontrar "Paleta de Chocolate" al buscar "paletta"');
assert(result2[0].NombreProducto.includes('Paleta'), `Primer resultado debe ser Paleta (obtenido: ${result2[0]?.NombreProducto})`);

const result3 = fuzzySearchProducts('volcan fresa', productos);
assert(result3.length > 0, 'Debe encontrar "Volcán de Fresa" al buscar "volcan fresa"');
assert(result3[0].NombreProducto.includes('Volcán'), `Primer resultado debe ser Volcán (obtenido: ${result3[0]?.NombreProducto})`);

const result4 = fuzzySearchProducts('litro vainilla', productos);
assert(result4.length > 0, 'Debe encontrar "Litro de Vainilla" al buscar "litro vainilla"');

const result5 = fuzzySearchProducts('caja', productos);
assert(result5.length > 0, 'Debe encontrar "Caja Familiar" al buscar "caja"');
assert(result5[0].NombreProducto.includes('Caja'), `Primer resultado debe ser Caja (obtenido: ${result5[0]?.NombreProducto})`);

// Test 4: Búsqueda fuzzy de sabores con errores ortográficos
console.log('\n--- Test 4: Búsqueda Fuzzy de Sabores ---');

const sabor1 = fuzzySearchSabores('vainila', sabores);
assert(sabor1.length > 0, 'Debe encontrar "Vainilla" al buscar "vainila"');
assert(sabor1[0].NombreProducto === 'Vainilla', `Primer resultado debe ser Vainilla (obtenido: ${sabor1[0]?.NombreProducto})`);

const sabor2 = fuzzySearchSabores('chocolat', sabores);
assert(sabor2.length > 0, 'Debe encontrar "Chocolate" al buscar "chocolat"');
assert(sabor2[0].NombreProducto === 'Chocolate', `Primer resultado debe ser Chocolate (obtenido: ${sabor2[0]?.NombreProducto})`);

const sabor3 = fuzzySearchSabores('areqipe', sabores);
assert(sabor3.length > 0, 'Debe encontrar "Arequipe" al buscar "areqipe"');
assert(sabor3[0].NombreProducto === 'Arequipe', `Primer resultado debe ser Arequipe (obtenido: ${sabor3[0]?.NombreProducto})`);

const sabor4 = fuzzySearchSabores('lucuma', sabores);
assert(sabor4.length > 0, 'Debe encontrar "Lúcuma" al buscar "lucuma" (sin acento)');
assert(sabor4[0].NombreProducto === 'Lúcuma', `Primer resultado debe ser Lúcuma (obtenido: ${sabor4[0]?.NombreProducto})`);

// Test 5: Búsqueda fuzzy de toppings con errores ortográficos
console.log('\n--- Test 5: Búsqueda Fuzzy de Toppings ---');

const topping1 = fuzzySearchToppings('chispas', toppings);
assert(topping1.length > 0, 'Debe encontrar "Chispas de Chocolate" al buscar "chispas"');
assert(topping1[0].NombreProducto.includes('Chispas'), `Primer resultado debe contener Chispas (obtenido: ${topping1[0]?.NombreProducto})`);

const topping2 = fuzzySearchToppings('gomita', toppings);
assert(topping2.length > 0, 'Debe encontrar "Gomitas" al buscar "gomita"');
assert(topping2[0].NombreProducto === 'Gomitas', `Primer resultado debe ser Gomitas (obtenido: ${topping2[0]?.NombreProducto})`);

const topping3 = fuzzySearchToppings('nueces', toppings);
assert(topping3.length > 0, 'Debe encontrar "Nueces" al buscar "nueces"');

const topping4 = fuzzySearchToppings('malvavisco', toppings);
assert(topping4.length > 0, 'Debe encontrar "Malvaviscos" al buscar "malvavisco" (singular)');

// Test 6: Sugerencias cuando no hay coincidencia exacta
console.log('\n--- Test 6: Sugerencias con Búsqueda Tolerante ---');

const sugerencias1 = fuzzySearchProducts('kopa', productos, { threshold: 0.3 });
assert(sugerencias1.length > 0, 'Debe sugerir "Copa" al buscar "kopa" con umbral bajo');
assert(sugerencias1[0].NombreProducto.includes('Copa'), `Primera sugerencia debe ser Copa (obtenido: ${sugerencias1[0]?.NombreProducto})`);

const sugerencias2 = fuzzySearchProducts('palita', productos, { threshold: 0.4 });
assert(sugerencias2.length > 0, 'Debe sugerir "Paleta" al buscar "palita"');

// Test 7: No encontrar nada con umbral alto
console.log('\n--- Test 7: Sin Resultados con Umbral Alto ---');

const noResults = fuzzySearchProducts('xyz123', productos, { threshold: 0.8 });
assert(noResults.length === 0, 'No debe encontrar nada al buscar "xyz123" con umbral alto');

// Resumen
console.log('\n' + '='.repeat(50));
console.log(`📊 RESULTADOS FINALES:`);
console.log(`   ✅ Tests pasados: ${testsPass}`);
console.log(`   ❌ Tests fallidos: ${testsFail}`);
console.log(`   📈 Total: ${testsPass + testsFail}`);
console.log(`   🎯 Éxito: ${((testsPass / (testsPass + testsFail)) * 100).toFixed(1)}%`);
console.log('='.repeat(50));

if (testsFail === 0) {
    console.log('\n🎉 ¡Todos los tests pasaron! Sistema fuzzy search funcionando correctamente.');
    process.exit(0);
} else {
    console.log('\n⚠️  Algunos tests fallaron. Revisa la implementación.');
    process.exit(1);
}
