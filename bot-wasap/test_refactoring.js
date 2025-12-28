/**
 * Test Rápido - Validación de Refactorización
 * 
 * Este script prueba:
 * 1. Handler refactorizado carga correctamente
 * 2. Config loader funciona
 * 3. Todos los exports están presentes
 * 4. Módulos cargan sin errores
 */

'use strict';

console.log('🧪 Iniciando tests de validación...\n');

let errorsCount = 0;
let successCount = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        successCount++;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        errorsCount++;
    }
}

// ===================================
// TEST 1: Handler Principal
// ===================================
console.log('📦 Test 1: Handler Principal\n');

test('Handler carga sin errores', () => {
    const handler = require('./handlers/handler');
    if (!handler) throw new Error('Handler no cargó');
});

test('Exports principales presentes', () => {
    const handler = require('./handlers/handler');
    const requiredExports = [
        'processIncomingMessage',
        'setupSocketHandlers',
        'initializeUserSession',
        'getAdminJids',
        'sendMainMenu',
        'handleSeleccionOpcion',
        'handleBrowseImages',
        'handleSeleccionProducto',
        'handleSelectDetails',
        'handleSelectQuantity',
        'stopBackgroundTasks',
        'isChatMuted',
        'unmuteChat'
    ];
    
    for (const exportName of requiredExports) {
        if (!handler[exportName]) {
            throw new Error(`Falta export: ${exportName}`);
        }
    }
});

// ===================================
// TEST 2: Módulos Especializados
// ===================================
console.log('\n📦 Test 2: Módulos Especializados\n');

const modules = [
    'message.handler',
    'greetings.handler',
    'admin.handler',
    'menu.handler',
    'products.handler',
    'selection.handler',
    'reservations.handler',
    'parser.handler',
    'ai.handler',
    'handler.utils'
];

modules.forEach(moduleName => {
    test(`Módulo ${moduleName} carga`, () => {
        const mod = require(`./handlers/modules/${moduleName}`);
        if (!mod) throw new Error(`Módulo ${moduleName} no cargó`);
    });
});

// ===================================
// TEST 3: Config Loader
// ===================================
console.log('\n📦 Test 3: Sistema de Configuración\n');

test('Config loader carga', () => {
    const config = require('./config/index');
    if (!config) throw new Error('Config no cargó');
});

test('Lista negocios disponibles', () => {
    const config = require('./config/index');
    const businesses = config.listAvailableBusinesses();
    if (!Array.isArray(businesses)) {
        throw new Error('listAvailableBusinesses no retorna array');
    }
    if (businesses.length === 0) {
        throw new Error('No hay negocios disponibles');
    }
    console.log(`   Negocios encontrados: ${businesses.join(', ')}`);
});

test('Información de negocios', () => {
    const config = require('./config/index');
    const info = config.getBusinessesInfo();
    if (!Array.isArray(info)) {
        throw new Error('getBusinessesInfo no retorna array');
    }
    info.forEach(business => {
        console.log(`   - ${business.name} (${business.id}) - ${business.city}`);
    });
});

test('Inicialización de config', () => {
    const config = require('./config/index');
    const cfg = config.initialize('heladeria1');
    if (!cfg) throw new Error('initialize no retorna config');
    if (!cfg.business) throw new Error('Config sin sección business');
    console.log(`   Negocio: ${cfg.business.name}`);
    console.log(`   Ciudad: ${cfg.business.city}`);
});

test('Validación de config', () => {
    const config = require('./config/index');
    const cfg = config.getConfig();
    const validation = config.validateConfig(cfg);
    if (!validation.valid) {
        throw new Error(`Config inválida: ${validation.errors.join(', ')}`);
    }
});

test('Getters de secciones', () => {
    const config = require('./config/index');
    const sections = ['business', 'contact', 'bot', 'catalog', 'checkout', 'admin', 'backend', 'features'];
    sections.forEach(section => {
        const value = config[section];
        if (!value) {
            throw new Error(`Getter ${section} no funciona`);
        }
    });
});

test('getConfigValue con notación de punto', () => {
    const config = require('./config/index');
    const businessName = config.getConfigValue('business.name');
    if (!businessName) {
        throw new Error('getConfigValue no funciona');
    }
    console.log(`   business.name = ${businessName}`);
    
    const deliveryFee = config.getConfigValue('checkout.delivery.deliveryFee', 0);
    console.log(`   checkout.delivery.deliveryFee = ${deliveryFee}`);
});

// ===================================
// TEST 4: Saludos Colombianos
// ===================================
console.log('\n📦 Test 4: Saludos Colombianos\n');

test('Módulo de saludos carga', () => {
    const greetings = require('./config/greetings/greetings.colombia');
    if (!greetings) throw new Error('Greetings no cargó');
});

test('Detecta saludos correctamente', () => {
    const { isGreeting } = require('./config/greetings/greetings.colombia');
    
    const testCases = [
        { text: 'hola', expected: true },
        { text: 'quiubo', expected: true },
        { text: 'buenas', expected: true },
        { text: 'producto 123', expected: false },
        { text: '1', expected: false }
    ];
    
    testCases.forEach(({ text, expected }) => {
        const result = isGreeting(text);
        if (result !== expected) {
            throw new Error(`isGreeting("${text}") = ${result}, esperado: ${expected}`);
        }
    });
    
    console.log(`   Probados ${testCases.length} casos correctamente`);
});

// ===================================
// TEST 5: Integración
// ===================================
console.log('\n📦 Test 5: Integración\n');

test('Handler puede acceder a config', () => {
    const handler = require('./handlers/handler');
    const config = require('./config/index');
    
    // Simular lo que haría index.js
    config.initialize('heladeria1');
    const cfg = config.getConfig();
    
    if (!cfg.business.name) {
        throw new Error('Handler no puede acceder a config');
    }
    
    console.log(`   Config accesible: ${cfg.business.name}`);
});

test('Módulos pueden usar config', () => {
    const menuHandler = require('./handlers/modules/menu.handler');
    const config = require('./config/index');
    
    if (!config.bot) {
        throw new Error('Módulos no pueden acceder a config');
    }
    
    console.log(`   Módulos pueden acceder a: ${Object.keys(config.bot).length} propiedades de bot`);
});

// ===================================
// RESUMEN
// ===================================
console.log('\n' + '='.repeat(50));
console.log('📊 RESUMEN DE TESTS');
console.log('='.repeat(50));
console.log(`✅ Exitosos: ${successCount}`);
console.log(`❌ Fallidos: ${errorsCount}`);
console.log(`📈 Total: ${successCount + errorsCount}`);
console.log(`🎯 Tasa de éxito: ${((successCount / (successCount + errorsCount)) * 100).toFixed(1)}%`);
console.log('='.repeat(50));

if (errorsCount === 0) {
    console.log('\n🎉 ¡TODOS LOS TESTS PASARON!');
    console.log('✅ La refactorización está lista para commit\n');
    process.exit(0);
} else {
    console.log('\n⚠️  ALGUNOS TESTS FALLARON');
    console.log('❌ Revisa los errores antes de continuar\n');
    process.exit(1);
}
