/**
 * @fileoverview Tests para env.loader.js
 * 
 * Valida que el sistema de configuración ENV funciona correctamente:
 * - Carga de variables
 * - Valores por defecto
 * - Método get() con notación de punto
 * - Validación de configuración
 * - Renderizado de mensajes
 */

const assert = require('assert');

console.log('\n🧪 Iniciando tests de env.loader.js...\n');

// =============================================================================
// TEST 1: CARGA BÁSICA
// =============================================================================

console.log('Test 1: Carga básica de configuración');
try {
    const envConfig = require('./config/env.loader');
    
    assert(envConfig !== null, 'envConfig debe existir');
    assert(typeof envConfig === 'object', 'envConfig debe ser un objeto');
    
    console.log('✅ envConfig cargado correctamente');
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 2: ESTRUCTURA DE CONFIGURACIÓN
// =============================================================================

console.log('\nTest 2: Estructura de configuración');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar secciones principales
    const requiredSections = [
        'business',
        'nomenclature',
        'labels',
        'backend',
        'search',
        'messages',
        'checkout',
        'bot',
        'ui',
        'api',
        'googleSheets',
        'security',
        'debug',
        'env'
    ];
    
    requiredSections.forEach(section => {
        assert(envConfig[section] !== undefined, `Sección ${section} debe existir`);
    });
    
    console.log('✅ Todas las secciones principales existen');
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 3: VALORES POR DEFECTO
// =============================================================================

console.log('\nTest 3: Valores por defecto');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar valores por defecto críticos
    assert(envConfig.business.name !== '', 'business.name debe tener valor por defecto');
    assert(envConfig.nomenclature.productType !== '', 'nomenclature.productType debe tener valor');
    assert(envConfig.backend.fields.productName !== '', 'backend.fields.productName debe tener valor');
    assert(envConfig.search.productKeywords.length > 0, 'search.productKeywords debe tener valores');
    
    console.log('✅ Valores por defecto correctos');
    console.log(`   - Business: ${envConfig.business.name}`);
    console.log(`   - Product Type: ${envConfig.nomenclature.productType}`);
    console.log(`   - Keywords: ${envConfig.search.productKeywords.slice(0, 3).join(', ')}...`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 4: MÉTODO GET() CON NOTACIÓN DE PUNTO
// =============================================================================

console.log('\nTest 4: Método get() con notación de punto');
try {
    const envConfig = require('./config/env.loader');
    
    // Test acceso directo
    const businessName = envConfig.get('business.name');
    assert(businessName !== undefined, 'get() debe retornar business.name');
    
    // Test acceso anidado profundo
    const deliveryFee = envConfig.get('checkout.delivery.fee');
    assert(deliveryFee !== undefined, 'get() debe retornar valores anidados');
    assert(typeof deliveryFee === 'number', 'deliveryFee debe ser número');
    
    // Test con valor por defecto
    const nonExistent = envConfig.get('no.existe.esta.ruta', 'DEFAULT');
    assert(nonExistent === 'DEFAULT', 'get() debe retornar valor por defecto si no existe');
    
    console.log('✅ Método get() funciona correctamente');
    console.log(`   - business.name: ${businessName}`);
    console.log(`   - checkout.delivery.fee: ${deliveryFee}`);
    console.log(`   - valor inexistente (default): ${nonExistent}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 5: VALIDACIÓN DE CONFIGURACIÓN
// =============================================================================

console.log('\nTest 5: Validación de configuración');
try {
    const envConfig = require('./config/env.loader');
    
    const validation = envConfig.validate();
    
    assert(validation !== undefined, 'validate() debe retornar resultado');
    assert(typeof validation.valid === 'boolean', 'validation.valid debe ser booleano');
    assert(Array.isArray(validation.errors), 'validation.errors debe ser array');
    
    if (!validation.valid) {
        console.log('⚠️  Configuración inválida:');
        validation.errors.forEach(err => console.log(`   - ${err}`));
    } else {
        console.log('✅ Configuración válida');
    }
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 6: RENDERIZADO DE MENSAJES
// =============================================================================

console.log('\nTest 6: Renderizado de mensajes con placeholders');
try {
    const envConfig = require('./config/env.loader');
    
    const template = '¡Bienvenido a {businessName} en {city}! 🍦';
    const rendered = envConfig.messages.render(template, {
        businessName: 'Test Helados',
        city: 'Test City'
    });
    
    assert(rendered.includes('Test Helados'), 'Debe reemplazar {businessName}');
    assert(rendered.includes('Test City'), 'Debe reemplazar {city}');
    assert(!rendered.includes('{'), 'No debe quedar placeholders sin reemplazar');
    
    console.log('✅ Renderizado de mensajes funciona');
    console.log(`   Template: ${template}`);
    console.log(`   Rendered: ${rendered}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 7: RENDERIZADO CON VALORES POR DEFECTO
// =============================================================================

console.log('\nTest 7: Renderizado con valores por defecto del contexto');
try {
    const envConfig = require('./config/env.loader');
    
    // No pasamos variables, debe usar valores de envConfig automáticamente
    const template = 'Somos {businessName} en {city}. Vendemos {productTypePlural}.';
    const rendered = envConfig.messages.render(template);
    
    assert(!rendered.includes('{businessName}'), 'Debe usar business.name por defecto');
    assert(!rendered.includes('{city}'), 'Debe usar business.location.city por defecto');
    assert(!rendered.includes('{productTypePlural}'), 'Debe usar nomenclature.productTypePlural por defecto');
    
    console.log('✅ Renderizado con valores por defecto funciona');
    console.log(`   Rendered: ${rendered}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 8: NOMENCLATURA (CRÍTICO PARA GENERICIDAD)
// =============================================================================

console.log('\nTest 8: Nomenclatura genérica');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar que existen todos los campos de nomenclatura
    assert(envConfig.nomenclature.productType, 'productType debe existir');
    assert(envConfig.nomenclature.productTypePlural, 'productTypePlural debe existir');
    assert(envConfig.nomenclature.itemPrimary, 'itemPrimary debe existir');
    assert(envConfig.nomenclature.itemPrimarySingular, 'itemPrimarySingular debe existir');
    assert(envConfig.nomenclature.itemSecondary, 'itemSecondary debe existir');
    assert(envConfig.nomenclature.itemSecondarySingular, 'itemSecondarySingular debe existir');
    
    console.log('✅ Nomenclatura completa');
    console.log(`   Producto: ${envConfig.nomenclature.productType} → ${envConfig.nomenclature.productTypePlural}`);
    console.log(`   Item Primario: ${envConfig.nomenclature.itemPrimarySingular} → ${envConfig.nomenclature.itemPrimary}`);
    console.log(`   Item Secundario: ${envConfig.nomenclature.itemSecondarySingular} → ${envConfig.nomenclature.itemSecondary}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 9: CAMPOS DE BASE DE DATOS
// =============================================================================

console.log('\nTest 9: Campos de base de datos');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar campos críticos
    assert(envConfig.backend.fields.productName, 'productName debe existir');
    assert(envConfig.backend.fields.productCode, 'productCode debe existir');
    assert(envConfig.backend.fields.itemPrimaryCount, 'itemPrimaryCount debe existir');
    assert(envConfig.backend.fields.itemSecondaryCount, 'itemSecondaryCount debe existir');
    
    console.log('✅ Campos de BD correctos');
    console.log(`   Nombre Producto: ${envConfig.backend.fields.productName}`);
    console.log(`   Código Producto: ${envConfig.backend.fields.productCode}`);
    console.log(`   Count Item Primario: ${envConfig.backend.fields.itemPrimaryCount}`);
    console.log(`   Count Item Secundario: ${envConfig.backend.fields.itemSecondaryCount}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 10: KEYWORDS DE BÚSQUEDA
// =============================================================================

console.log('\nTest 10: Keywords de búsqueda');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar que keywords son array
    assert(Array.isArray(envConfig.search.productKeywords), 'productKeywords debe ser array');
    assert(envConfig.search.productKeywords.length > 0, 'productKeywords debe tener elementos');
    
    // Verificar regex generado
    assert(envConfig.search.productKeywordsRegex, 'productKeywordsRegex debe existir');
    assert(envConfig.search.productKeywordsRegex instanceof RegExp, 'productKeywordsRegex debe ser RegExp');
    
    // Test del regex
    const testText = envConfig.search.productKeywords[0]; // Primera keyword
    assert(envConfig.search.productKeywordsRegex.test(testText), 'Regex debe detectar keywords');
    
    console.log('✅ Keywords de búsqueda correctas');
    console.log(`   Keywords: ${envConfig.search.productKeywords.join(', ')}`);
    console.log(`   Regex pattern: ${envConfig.search.productKeywordsRegex.source}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 11: CONFIGURACIÓN DE ENTREGA
// =============================================================================

console.log('\nTest 11: Configuración de entrega');
try {
    const envConfig = require('./config/env.loader');
    
    assert(typeof envConfig.checkout.delivery.enabled === 'boolean', 'delivery.enabled debe ser booleano');
    assert(typeof envConfig.checkout.delivery.fee === 'number', 'delivery.fee debe ser número');
    assert(typeof envConfig.checkout.delivery.minOrder === 'number', 'delivery.minOrder debe ser número');
    
    console.log('✅ Configuración de entrega correcta');
    console.log(`   Habilitado: ${envConfig.checkout.delivery.enabled}`);
    console.log(`   Tarifa: ${envConfig.checkout.delivery.fee}`);
    console.log(`   Pedido mínimo: ${envConfig.checkout.delivery.minOrder}`);
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// TEST 12: MÉTODO printSummary()
// =============================================================================

console.log('\nTest 12: Método printSummary()');
try {
    const envConfig = require('./config/env.loader');
    
    // Verificar que el método existe
    assert(typeof envConfig.printSummary === 'function', 'printSummary debe ser función');
    
    // Ejecutar (solo mostrará output, no validamos nada)
    console.log('\n--- Resumen de Configuración ---');
    envConfig.printSummary();
    console.log('--- Fin del Resumen ---\n');
    
    console.log('✅ Método printSummary() funciona');
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

// =============================================================================
// RESUMEN FINAL
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('✅ TODOS LOS TESTS DE env.loader.js PASARON');
console.log('='.repeat(60));
console.log('Total de tests: 12');
console.log('Pasados: 12');
console.log('Fallidos: 0');
console.log('='.repeat(60) + '\n');

process.exit(0);
