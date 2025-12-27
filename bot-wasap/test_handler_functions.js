/**
 * Test Suite para funciones principales de handler.js
 * Ejecutar con: node test_handler_functions.js
 */

const PHASE = require('./utils/phases');

// ==========================================
// MOCK DE DEPENDENCIAS
// ==========================================
const mockSock = {
    sendMessage: async (jid, message) => {
        console.log(`[MOCK] Enviando a ${jid}: ${JSON.stringify(message).substring(0, 100)}`);
        return { key: { id: 'mock-id' } };
    }
};

const mockCtx = {
    sessions: {},
    productsCache: [
        { CodigoProducto: 'COPA001', NombreProducto: 'Copa Helado', Precio_Venta: 8000, Numero_de_Sabores: 2, Numero_de_Toppings: 3 },
        { CodigoProducto: 'VOLCAN001', NombreProducto: 'Volcán Brownie', Precio_Venta: 12000, Numero_de_Sabores: 0, Numero_de_Toppings: 0 },
        { CodigoProducto: 'BUHO001', NombreProducto: 'Búho Helado', Precio_Venta: 15000, Numero_de_Sabores: 3, Numero_de_Toppings: 2 }
    ],
    mutedChats: new Set(),
    config: {
        adminPhones: ['573001234567@s.whatsapp.net']
    }
};

// ==========================================
// IMPORTAR FUNCIONES DEL HANDLER
// ==========================================
const handler = require('./handlers/handler');

// ==========================================
// FUNCIONES DE UTILIDAD PARA TESTS
// ==========================================
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        testsFailed++;
    }
}

function assertEqual(actual, expected, testName) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        console.log(`   Esperado: ${JSON.stringify(expected)}`);
        console.log(`   Obtenido: ${JSON.stringify(actual)}`);
        testsFailed++;
    }
}

// ==========================================
// TESTS DE FUNCIONES EXPORTADAS
// ==========================================

console.log('\n========================================');
console.log('INICIANDO TESTS DE HANDLER.JS');
console.log('========================================\n');

// TEST 1: initializeUserSession
console.log('--- Test 1: initializeUserSession ---');
try {
    const jid = '573001234567@s.whatsapp.net';
    const session = handler.initializeUserSession(jid, mockCtx);
    
    assert(session !== null, 'initializeUserSession devuelve sesión');
    assert(session.phase === PHASE.SELECCION_OPCION, 'initializeUserSession fase inicial correcta');
    assert(session.miaActivo === true, 'initializeUserSession MIA activo por defecto');
    assert(session.errorCount === 0, 'initializeUserSession errorCount inicial es 0');
    assert(Array.isArray(session.order.items), 'initializeUserSession carrito inicializado');
} catch (e) {
    console.log(`❌ FAIL: initializeUserSession - Error: ${e.message}`);
    testsFailed++;
}

// TEST 2: getAdminJids
console.log('\n--- Test 2: getAdminJids ---');
try {
    const adminJids = handler.getAdminJids();
    
    assert(Array.isArray(adminJids), 'getAdminJids devuelve array');
    assert(adminJids.length > 0, 'getAdminJids devuelve al menos un admin');
    console.log(`   Admins encontrados: ${adminJids.join(', ')}`);
} catch (e) {
    console.log(`❌ FAIL: getAdminJids - Error: ${e.message}`);
    testsFailed++;
}

// TEST 3: isChatMuted / unmuteChat
console.log('\n--- Test 3: isChatMuted / unmuteChat ---');
try {
    const testJid = '573009999999@s.whatsapp.net';
    
    // Inicialmente no debe estar silenciado
    assert(!handler.isChatMuted(testJid, mockCtx), 'isChatMuted - Chat no silenciado inicialmente');
    
    // Silenciar manualmente
    mockCtx.mutedChats.add(testJid);
    assert(handler.isChatMuted(testJid, mockCtx), 'isChatMuted - Chat silenciado después de add');
    
    // Reactivar
    const unmuted = handler.unmuteChat(testJid, mockCtx);
    assert(unmuted === true, 'unmuteChat - Devuelve true al reactivar');
    assert(!handler.isChatMuted(testJid, mockCtx), 'isChatMuted - Chat NO silenciado después de unmute');
    
    // Intentar reactivar de nuevo (no debe estar silenciado)
    const unmuted2 = handler.unmuteChat(testJid, mockCtx);
    assert(unmuted2 === false, 'unmuteChat - Devuelve false si ya está activo');
} catch (e) {
    console.log(`❌ FAIL: isChatMuted/unmuteChat - Error: ${e.message}`);
    testsFailed++;
}

// TEST 4: sendMainMenu
console.log('\n--- Test 4: sendMainMenu ---');
(async () => {
    try {
        const testJid = '573001111111@s.whatsapp.net';
        await handler.sendMainMenu(mockSock, testJid, mockCtx);
        console.log(`✅ PASS: sendMainMenu ejecutado sin errores`);
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: sendMainMenu - Error: ${e.message}`);
        testsFailed++;
    }
    
    // TEST 5: handleSeleccionOpcion
    console.log('\n--- Test 5: handleSeleccionOpcion ---');
    try {
        const testJid = '573002222222@s.whatsapp.net';
        const session = handler.initializeUserSession(testJid, mockCtx);
        
        // Opción 1 (menú)
        await handler.handleSeleccionOpcion(mockSock, testJid, '1', session, mockCtx);
        assert(session.phase === PHASE.BROWSE_IMAGES, 'handleSeleccionOpcion - Opción 1 cambia fase a BROWSE_IMAGES');
        
        // Reset
        session.phase = PHASE.SELECCION_OPCION;
        
        // Opción 3 (dirección)
        await handler.handleSeleccionOpcion(mockSock, testJid, '3', session, mockCtx);
        assert(session.phase === PHASE.SELECCION_OPCION, 'handleSeleccionOpcion - Opción 3 mantiene en menú');
        
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: handleSeleccionOpcion - Error: ${e.message}`);
        testsFailed++;
    }
    
    // TEST 6: handleBrowseImages
    console.log('\n--- Test 6: handleBrowseImages ---');
    try {
        const testJid = '573003333333@s.whatsapp.net';
        const session = handler.initializeUserSession(testJid, mockCtx);
        session.phase = PHASE.BROWSE_IMAGES;
        
        // Buscar producto existente
        await handler.handleBrowseImages(mockSock, testJid, 'copa', session, mockCtx);
        assert(session.currentProduct !== null, 'handleBrowseImages - Producto encontrado');
        assert(session.currentProduct.NombreProducto === 'Copa Helado', 'handleBrowseImages - Producto correcto');
        
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: handleBrowseImages - Error: ${e.message}`);
        testsFailed++;
    }
    
    // TEST 7: handleSelectDetails (sabores)
    console.log('\n--- Test 7: handleSelectDetails (sabores) ---');
    try {
        const testJid = '573004444444@s.whatsapp.net';
        const session = handler.initializeUserSession(testJid, mockCtx);
        session.phase = PHASE.SELECT_DETAILS;
        session.currentProduct = mockCtx.productsCache[0]; // Copa con 2 sabores
        session.saboresSeleccionados = [];
        session.awaitingField = 'sabores';
        
        // Añadir sabor 1
        await handler.handleSelectDetails(mockSock, testJid, 's1', session, mockCtx);
        assert(session.saboresSeleccionados.length === 1, 'handleSelectDetails - Sabor 1 añadido');
        
        // Añadir sabor 2
        await handler.handleSelectDetails(mockSock, testJid, 's2', session, mockCtx);
        assert(session.saboresSeleccionados.length === 2, 'handleSelectDetails - Sabor 2 añadido');
        
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: handleSelectDetails - Error: ${e.message}`);
        testsFailed++;
    }
    
    // TEST 8: handleSelectQuantity
    console.log('\n--- Test 8: handleSelectQuantity ---');
    try {
        const testJid = '573005555555@s.whatsapp.net';
        const session = handler.initializeUserSession(testJid, mockCtx);
        session.phase = PHASE.SELECT_QUANTITY;
        session.currentProduct = mockCtx.productsCache[1]; // Volcán (sin sabores/toppings)
        session.saboresSeleccionados = [];
        session.toppingsSeleccionados = [];
        
        // Añadir cantidad 2
        await handler.handleSelectQuantity(mockSock, testJid, '2', session, mockCtx);
        
        // Verificar que se añadió al carrito
        const cart = session.order.items;
        assert(cart.length > 0, 'handleSelectQuantity - Producto añadido al carrito');
        
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: handleSelectQuantity - Error: ${e.message}`);
        testsFailed++;
    }
    
    // TEST 9: stopBackgroundTasks
    console.log('\n--- Test 9: stopBackgroundTasks ---');
    try {
        const stopped = await handler.stopBackgroundTasks();
        assert(stopped === true, 'stopBackgroundTasks - Devuelve true');
        testsPassed++;
    } catch (e) {
        console.log(`❌ FAIL: stopBackgroundTasks - Error: ${e.message}`);
        testsFailed++;
    }
    
    // ==========================================
    // RESUMEN FINAL
    // ==========================================
    console.log('\n========================================');
    console.log('RESUMEN DE TESTS');
    console.log('========================================');
    console.log(`✅ Tests pasados: ${testsPassed}`);
    console.log(`❌ Tests fallidos: ${testsFailed}`);
    console.log(`📊 Total: ${testsPassed + testsFailed}`);
    console.log(`📈 Tasa de éxito: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(2)}%`);
    console.log('========================================\n');
    
    if (testsFailed === 0) {
        console.log('🎉 ¡TODOS LOS TESTS PASARON! 🎉\n');
        process.exit(0);
    } else {
        console.log('⚠️  Algunos tests fallaron. Revisa los errores arriba.\n');
        process.exit(1);
    }
})();
