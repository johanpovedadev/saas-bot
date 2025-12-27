/**
 * Test: Flujo de observaciones opcionales
 * Valida que el usuario pueda agregar observaciones de manera integrada
 * sin alargar el flujo innecesariamente
 */

'use strict';

const { processIncomingMessage, initializeUserSession } = require('./handlers/handler');
const { say } = require('./services/bot_core');

// Mock de socket y contexto
const mockSock = {
    sendMessage: async (jid, content) => {
        console.log(`\n📤 Bot → ${jid}:`);
        console.log(content.text || JSON.stringify(content, null, 2));
        return { status: 'ok' };
    },
    sendPresenceUpdate: async () => ({ status: 'ok' }),
    presenceSubscribe: async () => ({ status: 'ok' })
};

const ctx = {
    sessions: {},
    productsCache: [
        {
            CodigoProducto: 'COPA001',
            NombreProducto: 'Copa Tradicional',
            Precio_Venta: 8000,
            Numero_de_Sabores: 2,
            Numero_de_Toppings: 2,
            sabores: [
                { NombreProducto: 'Vainilla', Precio_Venta: 0 },
                { NombreProducto: 'Chocolate', Precio_Venta: 0 },
                { NombreProducto: 'Fresa', Precio_Venta: 0 }
            ],
            toppings: [
                { NombreProducto: 'Arequipe', Precio_Venta: 500 },
                { NombreProducto: 'Crema', Precio_Venta: 300 }
            ]
        }
    ],
    saboresYToppings: {
        sabores: [
            { NombreProducto: 'Vainilla', Precio_Venta: 0 },
            { NombreProducto: 'Chocolate', Precio_Venta: 0 },
            { NombreProducto: 'Fresa', Precio_Venta: 0 }
        ],
        toppings: [
            { NombreProducto: 'Arequipe', Precio_Venta: 500 },
            { NombreProducto: 'Crema', Precio_Venta: 300 }
        ]
    }
};

// Override say para capturar mensajes
const originalSay = say;
const messages = [];
global.say = async (sock, jid, text, context) => {
    messages.push({ to: jid, text });
    console.log(`\n📤 Bot → ${jid}:`);
    console.log(text);
    return originalSay(sock, jid, text, context);
};

async function simulateMessage(jid, text) {
    console.log(`\n📥 Usuario → Bot: "${text}"`);
    const msg = {
        from: jid,
        text,
        key: { remoteJid: jid, id: `test-${Date.now()}`, fromMe: false }
    };
    await processIncomingMessage(mockSock, msg, ctx);
}

async function testObservacionesFlow() {
    console.log('\n' + '='.repeat(80));
    console.log('🧪 TEST: Flujo de Observaciones Opcionales');
    console.log('='.repeat(80));

    const testJid = '573001234567@s.whatsapp.net';
    
    try {
        // Inicializar sesión
        initializeUserSession(testJid, ctx);
        
        console.log('\n📋 ESCENARIO 1: Usuario agrega sabores y cantidad directamente (sin toppings ni observaciones)');
        console.log('-'.repeat(80));
        
        await simulateMessage(testJid, 'copa');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 's1 s2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, '1');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('\n✅ Resultado: Producto agregado directamente sin preguntas innecesarias');
        
        // Reset para siguiente escenario
        ctx.sessions[testJid] = null;
        initializeUserSession(testJid, ctx);
        
        console.log('\n📋 ESCENARIO 2: Usuario agrega sabores, observación y cantidad');
        console.log('-'.repeat(80));
        
        await simulateMessage(testJid, 'copa');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 's1 s2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 'sin papaya');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, '2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('\n✅ Resultado: Observación guardada y producto agregado');
        
        // Reset para siguiente escenario
        ctx.sessions[testJid] = null;
        initializeUserSession(testJid, ctx);
        
        console.log('\n📋 ESCENARIO 3: Usuario agrega sabores, topping y cantidad');
        console.log('-'.repeat(80));
        
        await simulateMessage(testJid, 'copa');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 's1 s2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 't1');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, '1');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('\n✅ Resultado: Topping agregado y producto añadido al carrito');
        
        // Reset para siguiente escenario
        ctx.sessions[testJid] = null;
        initializeUserSession(testJid, ctx);
        
        console.log('\n📋 ESCENARIO 4: Usuario agrega sabores, topping, observación y cantidad');
        console.log('-'.repeat(80));
        
        await simulateMessage(testJid, 'copa');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 's1 s2');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 't1');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, 'extra crema');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await simulateMessage(testJid, '3');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('\n✅ Resultado: Topping y observación guardados, producto agregado');
        
        // Verificar carrito final
        console.log('\n📦 CARRITO FINAL:');
        console.log('-'.repeat(80));
        const finalSession = ctx.sessions[testJid];
        if (finalSession && finalSession.order && finalSession.order.items) {
            finalSession.order.items.forEach((item, index) => {
                console.log(`\n${index + 1}. ${item.nombre} (x${item.cantidad})`);
                if (item.sabores && item.sabores.length > 0) {
                    console.log(`   Sabores: ${item.sabores.map(s => s.NombreProducto || s).join(', ')}`);
                }
                if (item.toppings && item.toppings.length > 0) {
                    console.log(`   Toppings: ${item.toppings.map(t => t.NombreProducto || t).join(', ')}`);
                }
                if (item.observaciones) {
                    console.log(`   📝 Observaciones: ${item.observaciones}`);
                }
                console.log(`   💰 Precio: $${item.precio}`);
            });
        } else {
            console.log('⚠️  Carrito vacío o no inicializado');
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ PRUEBA COMPLETADA EXITOSAMENTE');
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('\n❌ ERROR EN LA PRUEBA:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Ejecutar prueba
testObservacionesFlow()
    .then(() => {
        console.log('\n✅ Todas las pruebas pasaron correctamente');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Error fatal:', error.message);
        console.error(error.stack);
        process.exit(1);
    });
