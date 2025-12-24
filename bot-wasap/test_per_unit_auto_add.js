/**
 * Test del flujo per-unit (diferente) para verificar que auto-agrega
 * sin pedir cantidad después de la segunda unidad
 */

const handler = require('./handlers/handler');
const { initializeUserSession } = require('./services/sessionService');
const PHASE = require('./utils/phases');

// Mock sock y ctx
const mockSock = {
    sendMessage: async (jid, content) => {
        console.log(`\n📱 [BOT → ${jid.split('@')[0]}]:`);
        if (content.text) {
            console.log(content.text);
        }
    }
};

const ctx = {
    sessions: {},
    saboresYToppings: {
        sabores: [
            { CodigoProducto: 'S1', NombreProducto: 'Chocolate' },
            { CodigoProducto: 'S2', NombreProducto: 'Vainilla' },
            { CodigoProducto: 'S3', NombreProducto: 'Fresa' },
            { CodigoProducto: 'S4', NombreProducto: 'Arequipe' },
            { CodigoProducto: 'S7', NombreProducto: 'Brownie' },
            { CodigoProducto: 'S8', NombreProducto: 'Mora' },
            { CodigoProducto: 'S9', NombreProducto: 'Lúcuma' }
        ],
        toppings: [
            { CodigoProducto: 'T1', NombreProducto: 'Chispas', Precio_Venta: 1000 },
            { CodigoProducto: 'T2', NombreProducto: 'Gomitas', Precio_Venta: 1000 }
        ]
    },
    carts: {}
};

const testJid = '573001234567@s.whatsapp.net';

async function runTest() {
    console.log('🧪 TEST: Flujo per-unit (diferente) - Auto-agregar segunda unidad\n');
    console.log('='.repeat(60));
    
    // Inicializar sesión
    const userSession = initializeUserSession(testJid, ctx);
    
    // Producto con 4 sabores y toppings
    const product = {
        CodigoProducto: 'P-CAJA',
        NombreProducto: 'Caja Familiar 4 Sabores',
        Precio_Venta: 25000,
        Numero_de_Sabores: 4,
        Numero_de_Toppings: 2,
        sabores: ctx.saboresYToppings.sabores,
        toppings: ctx.saboresYToppings.toppings
    };
    
    userSession.currentProduct = product;
    userSession.phase = PHASE.SELECT_DETAILS;
    userSession.awaitingField = 'sabores';
    
    console.log('\n📝 PASO 1: Usuario selecciona 3 sabores');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '1' },
        message: { conversation: 's1 s2 s7' }
    }, ctx);
    
    console.log('\n📝 PASO 2: Usuario completa 4to sabor');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '2' },
        message: { conversation: 's4' }
    }, ctx);
    
    console.log('\n📝 PASO 3: Usuario pide 2 unidades');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '3' },
        message: { conversation: '2' }
    }, ctx);
    
    console.log('\n📝 PASO 4: Usuario responde "diferente"');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '4' },
        message: { conversation: 'diferente' }
    }, ctx);
    
    console.log('\n📝 PASO 5: Usuario configura 2da unidad (s8 s9 s1 s3)');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '5' },
        message: { conversation: 's8 s9 s1 s3' }
    }, ctx);
    
    console.log('\n📝 PASO 6: Usuario responde con número (debería auto-agregar, NO pedir cantidad)');
    await handler.handleMessage(mockSock, {
        key: { remoteJid: testJid, fromMe: false, id: '6' },
        message: { conversation: '1' }
    }, ctx);
    
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ VERIFICACIÓN:');
    console.log(`Carrito:`, ctx.carts[testJid] || []);
    console.log(`Fase actual: ${userSession.phase}`);
    console.log(`AwaitingField: ${userSession.awaitingField}`);
    console.log(`PendingQuantity:`, userSession.pendingQuantity);
    
    if (ctx.carts[testJid] && ctx.carts[testJid].length === 2) {
        console.log('\n🎉 ¡TEST PASÓ! Se agregaron 2 unidades al carrito correctamente');
        console.log('Bot pasó automáticamente a fase de dirección/checkout');
    } else {
        console.log('\n❌ TEST FALLÓ. Cantidad de items en carrito:', ctx.carts[testJid]?.length || 0);
        console.log('Esperado: 2 unidades');
    }
}

runTest().catch(console.error);
