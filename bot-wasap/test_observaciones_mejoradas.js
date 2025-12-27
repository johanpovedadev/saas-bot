/**
 * Test del flujo mejorado de observaciones en el bot de WhatsApp
 * 
 * Valida los siguientes escenarios:
 * 1. "sin papaya" -> debe guardarse como observación
 * 2. "T1 sin papaya" -> debe guardar T1 como topping y "sin papaya" como observación
 * 3. "T1 T2 sin azúcar" -> debe guardar T1, T2 como toppings y "sin azúcar" como observación
 * 4. "sin" -> debe interpretarse como sin toppings ni observaciones
 * 5. "2" -> debe procesarse como cantidad
 */

const { handleSelectDetails } = require('./handlers/handler');
const PHASE = require('./utils/phases');

// Mock context
const ctx = {
    sessions: {},
    productos: [
        {
            CodigoProducto: 'BUHO',
            NombreProducto: 'Buho',
            Precio_Venta: 6000,
            Sabores_Requeridos: 2,
            Toppings_Permitidos: 3,
            sabores: [
                { NombreProducto: 'Vainilla', Precio_Venta: 0 },
                { NombreProducto: 'Chocolate', Precio_Venta: 0 },
                { NombreProducto: 'Fresa', Precio_Venta: 0 }
            ],
            toppings: [
                { NombreProducto: 'Arequipe', Precio_Venta: 500 },
                { NombreProducto: 'Crema', Precio_Venta: 300 },
                { NombreProducto: 'Papaya', Precio_Venta: 400 }
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
            { NombreProducto: 'Crema', Precio_Venta: 300 },
            { NombreProducto: 'Papaya', Precio_Venta: 400 }
        ]
    }
};

// Mock functions
const messages = [];
const say = async (sock, jid, message, ctx) => {
    messages.push({ jid, message });
    console.log(`\n[Bot -> ${jid}]`, message);
};

const sock = {}; // Mock socket

async function runTest() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  TEST: FLUJO MEJORADO DE OBSERVACIONES');
    console.log('═══════════════════════════════════════════════════════════\n');

    const jid = '573138777115@s.whatsapp.net';

    // Inicializar sesión
    ctx.sessions[jid] = {
        phase: PHASE.SELECT_DETAILS,
        currentProduct: ctx.productos[0],
        saboresSeleccionados: ['Vainilla', 'Chocolate'],
        toppingsSeleccionados: [],
        observaciones: '',
        awaitingField: 'toppings',
        order: { items: [] }
    };

    console.log('📋 ESCENARIO 1: Usuario escribe "sin papaya" (debería guardarse como observación)');
    console.log('─────────────────────────────────────────────────────────────\n');
      messages.length = 0;
    await handleSelectDetails(sock, jid, 'sin papaya', session1, ctx);
    
    const session1 = ctx.sessions[jid];
    console.log('\n✅ Resultado:');
    console.log(`   - Observaciones: "${session1.observaciones}"`);
    console.log(`   - Toppings: [${session1.toppingsSeleccionados.join(', ')}]`);
    console.log(`   - Siguiente paso: ${session1.awaitingField}`);
    
    if (session1.observaciones === 'sin papaya' && session1.toppingsSeleccionados.length === 0) {
        console.log('   ✔ PASS: Observación guardada correctamente');
    } else {
        console.log('   ✖ FAIL: La observación no se guardó como esperado');
    }

    // Reset para siguiente test
    ctx.sessions[jid] = {
        phase: PHASE.SELECT_DETAILS,
        currentProduct: ctx.productos[0],
        saboresSeleccionados: ['Vainilla', 'Chocolate'],
        toppingsSeleccionados: [],
        observaciones: '',
        awaitingField: 'toppings',
        order: { items: [] }
    };

    console.log('\n\n📋 ESCENARIO 2: Usuario escribe "T1 sin papaya" (topping + observación)');
    console.log('─────────────────────────────────────────────────────────────\n');
      messages.length = 0;
    await handleSelectDetails(sock, jid, 'T1 sin papaya', session2, ctx);
    
    const session2 = ctx.sessions[jid];
    console.log('\n✅ Resultado:');
    console.log(`   - Observaciones: "${session2.observaciones}"`);
    console.log(`   - Toppings: [${session2.toppingsSeleccionados.join(', ')}]`);
    console.log(`   - Siguiente paso: ${session2.awaitingField}`);
    
    if (session2.observaciones.includes('sin papaya') && session2.toppingsSeleccionados.includes('T1')) {
        console.log('   ✔ PASS: Topping y observación guardados correctamente');
    } else {
        console.log('   ✖ FAIL: No se procesaron correctamente');
    }

    // Reset para siguiente test
    ctx.sessions[jid] = {
        phase: PHASE.SELECT_DETAILS,
        currentProduct: ctx.productos[0],
        saboresSeleccionados: ['Vainilla', 'Chocolate'],
        toppingsSeleccionados: [],
        observaciones: '',
        awaitingField: 'toppings',
        order: { items: [] }
    };

    console.log('\n\n📋 ESCENARIO 3: Usuario escribe "T1 T2 sin azúcar" (múltiples toppings + observación)');
    console.log('─────────────────────────────────────────────────────────────\n');
      messages.length = 0;
    await handleSelectDetails(sock, jid, 'T1 T2 sin azúcar', session3, ctx);
    
    const session3 = ctx.sessions[jid];
    console.log('\n✅ Resultado:');
    console.log(`   - Observaciones: "${session3.observaciones}"`);
    console.log(`   - Toppings: [${session3.toppingsSeleccionados.join(', ')}]`);
    console.log(`   - Siguiente paso: ${session3.awaitingField}`);
    
    if (session3.observaciones.includes('sin azúcar') && 
        session3.toppingsSeleccionados.includes('T1') && 
        session3.toppingsSeleccionados.includes('T2')) {
        console.log('   ✔ PASS: Múltiples toppings y observación guardados correctamente');
    } else {
        console.log('   ✖ FAIL: No se procesaron correctamente');
    }

    // Reset para siguiente test
    ctx.sessions[jid] = {
        phase: PHASE.SELECT_DETAILS,
        currentProduct: ctx.productos[0],
        saboresSeleccionados: ['Vainilla', 'Chocolate'],
        toppingsSeleccionados: [],
        observaciones: '',
        awaitingField: 'toppings',
        order: { items: [] }
    };

    console.log('\n\n📋 ESCENARIO 4: Usuario escribe "sin" (sin toppings ni observaciones)');
    console.log('─────────────────────────────────────────────────────────────\n');
      messages.length = 0;
    await handleSelectDetails(sock, jid, 'sin', session4, ctx);
    
    const session4 = ctx.sessions[jid];
    console.log('\n✅ Resultado:');
    console.log(`   - Observaciones: "${session4.observaciones}"`);
    console.log(`   - Toppings: [${session4.toppingsSeleccionados.join(', ')}]`);
    console.log(`   - Siguiente paso: ${session4.awaitingField}`);
    
    if (session4.toppingsSeleccionados.length === 0 && !session4.observaciones) {
        console.log('   ✔ PASS: Interpretado correctamente como "sin nada"');
    } else {
        console.log('   ✖ FAIL: No se interpretó correctamente');
    }

    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('  RESUMEN DE TESTS');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('✅ Test completado. Revisa los resultados arriba.');
    console.log('\n');
}

runTest().catch(err => {
    console.error('Error en test:', err);
    process.exit(1);
});
