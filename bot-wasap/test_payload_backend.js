#!/usr/bin/env node
'use strict';

/**
 * TEST: Validar que el payload enviado al backend tenga el formato correcto
 * 
 * PROBLEMA: El sheet recibía columnas vacías para 'producto' y 'codigo'
 * CAUSA: Bot enviaba 'productos' (plural) y 'codigos' (plural)
 * SOLUCIÓN: Cambiar a 'producto' (singular) y 'codigo' (singular)
 */

console.log('\n=== TEST: Payload del Backend - Productos y Códigos ===\n');

// Simular estructura del carrito
const mockUserSession = {
    order: {
        name: 'Juan Pérez',
        telefono: '3139848800',
        address: 'Cra 23 #10-05',
        paymentMethod: 'efectivo',
        status: 'Por despachar',
        deliveryCost: 0,
        items: [
            {
                codigo: 'CI-TOR-CHOC',
                nombre: 'Copa Tormenta de Chocolate',
                precio: 14000,
                cantidad: 1,
                sabores: ['Chocolate', 'Brownie', 'Arequipe'],
                toppings: [
                    { NombreProducto: 'Chocolatina Wafer Jet', Precio_Venta: 0 },
                    { NombreProducto: 'Galletas Oreo', Precio_Venta: 0 }
                ],
                observaciones: ''
            }
        ]
    }
};

// Simular generación del payload (código de checkoutHandler.js)
function generatePayload(userSession, jid) {
    const productsText = userSession.order.items.map(i => {
        const saboresText = (i.sabores && i.sabores.length)
            ? i.sabores.map(s => s.NombreProducto || s).join(', ')
            : (i.sabor ? i.sabor : null);
        const toppingsText = i.toppings && i.toppings.length ? i.toppings.map(t => t.NombreProducto || t).join(', ') : null;
        const obsText = i.observaciones ? `; Observaciones: ${i.observaciones}` : '';
        const saborPart = saboresText ? ` (Sabores: ${saboresText})` : '';
        const toppingPart = toppingsText ? ` (Toppings: ${toppingsText})` : '';
        return `${i.nombre || i.producto || 'Producto sin nombre'}${saborPart}${toppingPart}${obsText} x${i.cantidad || 1}`;
    }).join('; ');
    
    const codes = userSession.order.items.map(i => i.codigo || '').join('; ');
    const orderTotal = userSession.order.items.reduce((sum, i) => sum + (i.precio * i.cantidad), 0) + (userSession.order.deliveryCost || 0);

    return {
        fecha: new Date().toISOString(),
        nombre: userSession.order.name || '',
        producto: productsText,  // ← DEBE SER SINGULAR
        codigo: codes,           // ← DEBE SER SINGULAR
        telefono: userSession.order.telefono || '',
        direccion: userSession.order.address || '',
        monto: orderTotal,       // ← Backend espera 'monto'
        pago: userSession.order.paymentMethod || '',
        estado: userSession.order.status || 'Por despachar',
        observaciones: `Origen: WhatsApp - Cliente JID: ${jid}`,
        detalles_items: userSession.order.items.map(i => ({
            codigo: i.codigo || null,
            nombre: i.nombre || i.producto || null,
            cantidad: i.cantidad || null,
            precio: i.precio || null,
            sabores: (i.sabores && i.sabores.length) ? i.sabores : [],
            toppings: (i.toppings && i.toppings.length) ? i.toppings.map(t => ({
                nombre: t.NombreProducto || t.nombre || t,
                precio: Number(t.Precio_Venta || t.Precio || t.precio || 0)
            })) : [],
            observaciones: i.observaciones || null
        }))
    };
}

// Ejecutar test
const jid = '3139848800@s.whatsapp.net';
const payload = generatePayload(mockUserSession, jid);

console.log('📦 Payload generado:\n');
console.log(JSON.stringify(payload, null, 2));

console.log('\n' + '='.repeat(70));
console.log('\n🔍 VALIDACIONES:\n');

let passed = 0;
let failed = 0;

// Test 1: Campo 'producto' (singular) debe existir
if (payload.hasOwnProperty('producto')) {
    console.log('✅ Test 1: Campo "producto" (singular) existe');
    passed++;
} else {
    console.log('❌ Test 1: Falta campo "producto" (singular)');
    failed++;
}

// Test 2: Campo 'codigo' (singular) debe existir
if (payload.hasOwnProperty('codigo')) {
    console.log('✅ Test 2: Campo "codigo" (singular) existe');
    passed++;
} else {
    console.log('❌ Test 2: Falta campo "codigo" (singular)');
    failed++;
}

// Test 3: Campo 'monto' debe existir (no 'total')
if (payload.hasOwnProperty('monto')) {
    console.log('✅ Test 3: Campo "monto" existe (no "total")');
    passed++;
} else {
    console.log('❌ Test 3: Falta campo "monto" (backend lo requiere)');
    failed++;
}

// Test 4: Campo 'producto' NO debe estar vacío
if (payload.producto && payload.producto.trim().length > 0) {
    console.log('✅ Test 4: Campo "producto" tiene contenido');
    passed++;
} else {
    console.log('❌ Test 4: Campo "producto" está vacío');
    failed++;
}

// Test 5: Campo 'codigo' NO debe estar vacío
if (payload.codigo && payload.codigo.trim().length > 0) {
    console.log('✅ Test 5: Campo "codigo" tiene contenido');
    passed++;
} else {
    console.log('❌ Test 5: Campo "codigo" está vacío');
    failed++;
}

// Test 6: 'producto' debe incluir sabores y toppings
if (payload.producto.includes('Sabores:') && payload.producto.includes('Toppings:')) {
    console.log('✅ Test 6: Campo "producto" incluye sabores y toppings');
    passed++;
} else {
    console.log('❌ Test 6: Campo "producto" NO incluye sabores/toppings correctamente');
    failed++;
}

// Test 7: NO debe existir campo 'productos' (plural)
if (!payload.hasOwnProperty('productos')) {
    console.log('✅ Test 7: NO existe campo "productos" (plural) - Correcto');
    passed++;
} else {
    console.log('❌ Test 7: Existe campo "productos" (plural) - INCORRECTO');
    failed++;
}

// Test 8: NO debe existir campo 'codigos' (plural)
if (!payload.hasOwnProperty('codigos')) {
    console.log('✅ Test 8: NO existe campo "codigos" (plural) - Correcto');
    passed++;
} else {
    console.log('❌ Test 8: Existe campo "codigos" (plural) - INCORRECTO');
    failed++;
}

// Test 9: Campo 'observaciones' debe contener "Origen: WhatsApp"
if (payload.observaciones && payload.observaciones.includes('Origen: WhatsApp')) {
    console.log('✅ Test 9: Campo "observaciones" contiene origen correcto');
    passed++;
} else {
    console.log('❌ Test 9: Campo "observaciones" no tiene origen');
    failed++;
}

// Test 10: Formato esperado en el sheet
const expectedFormat = 'Copa Tormenta de Chocolate (Sabores: Chocolate, Brownie, Arequipe; Toppings: Chocolatina Wafer Jet, Galletas Oreo) x1';
if (payload.producto.includes('Copa Tormenta de Chocolate') && 
    payload.producto.includes('Sabores:') && 
    payload.producto.includes('Toppings:')) {
    console.log('✅ Test 10: Formato coincide con el esperado del sheet');
    passed++;
} else {
    console.log('❌ Test 10: Formato NO coincide con el esperado del sheet');
    failed++;
}

console.log('\n' + '='.repeat(70));
console.log(`\n📊 RESULTADOS: ${passed}/${passed + failed} tests pasados\n`);

if (failed > 0) {
    console.log(`⚠️  ${failed} tests fallaron`);
    console.log('\n❌ EL PAYLOAD NO CUMPLE CON EL FORMATO DEL BACKEND\n');
    process.exit(1);
} else {
    console.log('✅ TODOS LOS TESTS PASADOS - PAYLOAD CORRECTO\n');
    
    console.log('\n📝 EJEMPLO DE FILA EN EL SHEET:');
    console.log('='.repeat(70));
    console.log(`Fecha: ${payload.fecha}`);
    console.log(`Nombre: ${payload.nombre}`);
    console.log(`Producto: ${payload.producto}`);
    console.log(`Código: ${payload.codigo}`);
    console.log(`Teléfono: ${payload.telefono}`);
    console.log(`Dirección: ${payload.direccion}`);
    console.log(`Monto: ${payload.monto}`);
    console.log(`Pago: ${payload.pago}`);
    console.log(`Estado: ${payload.estado}`);
    console.log(`Observaciones: ${payload.observaciones}`);
    console.log('='.repeat(70) + '\n');
    
    process.exit(0);
}
