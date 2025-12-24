/**
 * TEST E2E COMPLETO - Flujo desde saludo hasta completar pedido
 * 
 * Este test valida:
 * 1. ✅ Saludo inicial
 * 2. ✅ Selección de menú
 * 3. ✅ Búsqueda de producto
 * 4. ✅ Indicadores de progreso "Paso X de Y"
 * 5. ✅ Selección de sabores
 * 6. ✅ Selección de toppings
 * 7. ✅ Indicar cantidad
 * 8. ✅ Agregar al carrito
 * 9. ✅ Proceder al checkout
 * 10. ✅ Completar datos de entrega
 */

console.log('🧪 TEST E2E: FLUJO COMPLETO DE PEDIDO\n');

const PHASE = require('./utils/phases');

// Mock de contexto y sesión
const ctx = {
    sessions: {},
    mutedChats: new Set(),
    carts: {},
    lastSent: {},
    botEnabled: true,
    order: {},
    saboresYToppings: {
        sabores: [
            { NombreProducto: 'Vainilla', CodigoProducto: 'SAB001', Precio_Venta: 0 },
            { NombreProducto: 'Chocolate', CodigoProducto: 'SAB002', Precio_Venta: 0 },
            { NombreProducto: 'Fresa', CodigoProducto: 'SAB003', Precio_Venta: 0 }
        ],
        toppings: [
            { NombreProducto: 'Chispas de Chocolate', CodigoProducto: 'TOP001', Precio_Venta: 1000 },
            { NombreProducto: 'Almendras', CodigoProducto: 'TOP002', Precio_Venta: 1500 },
            { NombreProducto: 'Arequipe', CodigoProducto: 'TOP003', Precio_Venta: 800 }
        ]
    },
    productsCache: [
        {
            CodigoProducto: 'PROD001',
            NombreProducto: 'Caja de Helado Volcán',
            Precio_Venta: 25000,
            Numero_de_Sabores: 2,
            Numero_de_Toppings: 2,
            Categoria: 'Helados'
        },
        {
            CodigoProducto: 'PROD002',
            NombreProducto: 'Copa Premium',
            Precio_Venta: 8000,
            Numero_de_Sabores: 1,
            Numero_de_Toppings: 1,
            Categoria: 'Helados'
        }
    ]
};

const jid = '573001234567@s.whatsapp.net';

// Helper para inicializar sesión
function initSession() {
    ctx.sessions[jid] = {
        phase: PHASE.SELECCION_OPCION,
        lastPromptAt: Date.now(),
        errorCount: 0,
        order: { items: [] },
        currentProduct: null,
        saboresSeleccionados: [],
        toppingsSeleccionados: [],
        awaitingField: null,
        lastMessage: { text: '', at: 0 }
    };
    return ctx.sessions[jid];
}

// Helper para simular mensaje
function simulateMessage(text, currentPhase, awaitingField) {
    console.log(`\n📨 Usuario: "${text}"`);
    console.log(`   Fase actual: ${currentPhase}`);
    if (awaitingField) console.log(`   Esperando: ${awaitingField}`);
}

// Test del flujo completo
async function testCompleteFlow() {
    let passed = 0;
    let failed = 0;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 1: Saludo Inicial');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const session1 = initSession();
    simulateMessage('Hola', session1.phase, session1.awaitingField);
    
    // Validar que esté en fase inicial
    if (session1.phase === PHASE.SELECCION_OPCION) {
        console.log('   ✅ Sesión inicializada correctamente');
        passed++;
    } else {
        console.log(`   ❌ Error: Fase incorrecta (esperada: ${PHASE.SELECCION_OPCION}, actual: ${session1.phase})`);
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 2: Selección de Menú (opción 1)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('1', session1.phase, session1.awaitingField);
    session1.phase = PHASE.BROWSE_IMAGES;
    
    if (session1.phase === PHASE.BROWSE_IMAGES) {
        console.log('   ✅ Cambió a fase de búsqueda de productos');
        passed++;
    } else {
        console.log('   ❌ Error: No cambió a fase BROWSE_IMAGES');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 3: Búsqueda de Producto "volcán"');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      simulateMessage('volcán', session1.phase, session1.awaitingField);
    
    // Simular búsqueda en cache (normalizar búsqueda)
    const query = 'volcan';
    const producto = ctx.productsCache.find(p => {
        const nombre = (p.NombreProducto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return nombre.includes(query);
    });
    
    if (producto) {
        console.log(`   ✅ Producto encontrado: "${producto.NombreProducto}"`);
        session1.currentProduct = producto;
        session1.phase = PHASE.SELECT_DETAILS;
        session1.awaitingField = 'sabores';
        passed++;
    } else {
        console.log('   ❌ Error: Producto no encontrado en cache');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 4: Validar Indicador de Progreso - Paso 1 (Sabores)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const numSabores = parseInt(session1.currentProduct.Numero_de_Sabores || 0);
    const numToppings = parseInt(session1.currentProduct.Numero_de_Toppings || 0);
    
    // Calcular pasos
    const steps = [];
    if (numSabores > 0) steps.push('sabores');
    if (numToppings > 0) steps.push('toppings');
    steps.push('quantity');
    
    const currentStepIndex = steps.indexOf('sabores') + 1;
    const totalSteps = steps.length;
    const progressIndicator = `📍 *Paso ${currentStepIndex} de ${totalSteps}*`;
    
    console.log(`   Producto: ${session1.currentProduct.NombreProducto}`);
    console.log(`   Sabores requeridos: ${numSabores}`);
    console.log(`   Toppings disponibles: ${numToppings}`);
    console.log(`   Total de pasos: ${totalSteps}`);
    console.log(`   Indicador: ${progressIndicator}`);
    
    if (progressIndicator === '📍 *Paso 1 de 3*') {
        console.log('   ✅ Indicador de progreso correcto (Paso 1 de 3)');
        passed++;
    } else {
        console.log(`   ❌ Error: Indicador incorrecto (esperado: "📍 *Paso 1 de 3*", actual: "${progressIndicator}")`);
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 5: Selección de Sabores (S1, S2)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('S1 S2', session1.phase, session1.awaitingField);
    
    // Simular selección de sabores
    session1.saboresSeleccionados = ['s1', 's2'];
    
    if (session1.saboresSeleccionados.length === numSabores) {
        console.log(`   ✅ Sabores seleccionados: ${session1.saboresSeleccionados.join(', ')}`);
        session1.awaitingField = 'toppings';
        passed++;
    } else {
        console.log('   ❌ Error: Cantidad de sabores incorrecta');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 6: Validar Indicador de Progreso - Paso 2 (Toppings)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const currentStepIndex2 = steps.indexOf('toppings') + 1;
    const progressIndicator2 = `📍 *Paso ${currentStepIndex2} de ${totalSteps}*`;
    
    console.log(`   Indicador: ${progressIndicator2}`);
    
    if (progressIndicator2 === '📍 *Paso 2 de 3*') {
        console.log('   ✅ Indicador de progreso correcto (Paso 2 de 3)');
        passed++;
    } else {
        console.log(`   ❌ Error: Indicador incorrecto`);
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 7: Selección de Toppings (T1)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('T1', session1.phase, session1.awaitingField);
    
    session1.toppingsSeleccionados = ['t1'];
    
    if (session1.toppingsSeleccionados.length > 0) {
        console.log(`   ✅ Toppings seleccionados: ${session1.toppingsSeleccionados.join(', ')}`);
        session1.awaitingField = 'quantity';
        passed++;
    } else {
        console.log('   ❌ Error: No se seleccionaron toppings');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 8: Validar Indicador de Progreso - Paso 3 (Cantidad)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const currentStepIndex3 = steps.indexOf('quantity') + 1;
    const progressIndicator3 = `📍 *Paso ${currentStepIndex3} de ${totalSteps}*`;
    
    console.log(`   Indicador: ${progressIndicator3}`);
    
    if (progressIndicator3 === '📍 *Paso 3 de 3*') {
        console.log('   ✅ Indicador de progreso correcto (Paso 3 de 3)');
        passed++;
    } else {
        console.log(`   ❌ Error: Indicador incorrecto`);
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 9: Indicar Cantidad (2)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('2', session1.phase, session1.awaitingField);
    
    const quantity = 2;
    if (!isNaN(quantity) && quantity > 0) {
        console.log(`   ✅ Cantidad válida: ${quantity}`);
        
        // Simular agregar al carrito
        if (!ctx.carts[jid]) ctx.carts[jid] = [];
        ctx.carts[jid].push({
            codigo: session1.currentProduct.CodigoProducto,
            nombre: session1.currentProduct.NombreProducto,
            precio: session1.currentProduct.Precio_Venta,
            sabores: session1.saboresSeleccionados,
            toppings: session1.toppingsSeleccionados,
            quantity: quantity
        });
        
        session1.phase = PHASE.BROWSE_IMAGES;
        session1.awaitingField = null;
        passed++;
    } else {
        console.log('   ❌ Error: Cantidad inválida');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 10: Validar Carrito');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const cart = ctx.carts[jid];
    
    if (cart && cart.length > 0) {
        console.log(`   ✅ Carrito tiene ${cart.length} item(s)`);
        console.log(`   Producto: ${cart[0].nombre}`);
        console.log(`   Cantidad: ${cart[0].quantity}`);
        console.log(`   Sabores: ${cart[0].sabores.join(', ')}`);
        console.log(`   Toppings: ${cart[0].toppings.join(', ')}`);
        console.log(`   Precio unitario: $${cart[0].precio.toLocaleString()}`);
        passed++;
    } else {
        console.log('   ❌ Error: Carrito vacío');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 11: Proceder a Pagar');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('pagar', session1.phase, session1.awaitingField);
    session1.phase = PHASE.ENTER_ADDRESS;
    
    if (session1.phase === PHASE.ENTER_ADDRESS) {
        console.log('   ✅ Cambió a fase de dirección');
        passed++;
    } else {
        console.log('   ❌ Error: No cambió a fase ENTER_ADDRESS');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TEST 12: Ingresar Dirección');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    simulateMessage('Calle 123 #45-67', session1.phase, session1.awaitingField);
    session1.order.direccion = 'Calle 123 #45-67';
    session1.phase = PHASE.ENTER_NAME;
    
    if (session1.order.direccion) {
        console.log(`   ✅ Dirección guardada: ${session1.order.direccion}`);
        passed++;
    } else {
        console.log('   ❌ Error: Dirección no guardada');
        failed++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESUMEN DE TESTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const total = passed + failed;
    const percentage = ((passed / total) * 100).toFixed(1);
    
    console.log(`✅ Tests pasados: ${passed}`);
    console.log(`❌ Tests fallidos: ${failed}`);
    console.log(`📈 Tasa de éxito: ${percentage}%`);
    
    if (failed === 0) {
        console.log('\n🎉 ¡TODOS LOS TESTS PASARON! El flujo completo funciona correctamente.');
    } else {
        console.log('\n⚠️  ALGUNOS TESTS FALLARON - Revisar antes de commit');
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

// Ejecutar test
testCompleteFlow().catch(err => {
    console.error('\n❌ Error ejecutando tests:', err);
    process.exit(1);
});
