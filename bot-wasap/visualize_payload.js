#!/usr/bin/env node
'use strict';

/**
 * VISUALIZADOR DE PAYLOAD - Google Sheets
 * 
 * Este script muestra exactamente qué datos se enviarán al backend
 * y cómo se verán en el Google Sheet, sin enviar nada.
 */

console.log('\n' + '='.repeat(80));
console.log('📊 VISUALIZADOR DE PAYLOAD - Validación Google Sheets');
console.log('='.repeat(80) + '\n');

// ============================================================================
// SIMULAR PEDIDO REAL (igual que test_send_to_sheet.js)
// ============================================================================

const mockOrder = {
    items: [
        {
            codigo: 'CI-TOR-CHOC',
            nombre: 'Copa Tormenta de Chocolate',
            cantidad: 2,
            precio: 9000,
            sabores: [
                { NombreProducto: 'Chocolate' },
                { NombreProducto: 'Brownie' },
                { NombreProducto: 'Arequipe' }
            ],
            toppings: [
                { NombreProducto: 'chocolatina wafer jet', Precio_Venta: 2500 },
                { NombreProducto: 'galletas oreo', Precio_Venta: 2500 }
            ],
            observaciones: 'Sin lactosa'
        },
        {
            codigo: 'MA-FRE-CHOC',
            nombre: 'Malteada Fresa con Chocolate',
            cantidad: 1,
            precio: 7500,
            sabores: [
                { NombreProducto: 'Fresa' },
                { NombreProducto: 'Chocolate' }
            ],
            toppings: [],
            observaciones: null
        },
        {
            codigo: 'SU-GEN',
            nombre: 'Sundae Genérico',
            cantidad: 1,
            precio: 6000,
            sabores: [
                { NombreProducto: 'Vainilla' }
            ],
            toppings: [
                { NombreProducto: 'M&M', Precio_Venta: 2000 }
            ],
            observaciones: null
        }
    ]
};

// ============================================================================
// CONSTRUIR DATOS (igual que checkoutHandler.js)
// ============================================================================

const productsText = mockOrder.items.map(i => {
    const saboresText = (i.sabores && i.sabores.length)
        ? i.sabores.map(s => s.NombreProducto || s).join(', ')
        : null;
    const toppingsText = i.toppings && i.toppings.length 
        ? i.toppings.map(t => t.NombreProducto || t).join(', ') 
        : null;
    const obsText = i.observaciones ? `; Observaciones: ${i.observaciones}` : '';
    const saborPart = saboresText ? ` (Sabores: ${saboresText})` : '';
    const toppingPart = toppingsText ? ` (Toppings: ${toppingsText})` : '';
    return `${i.nombre}${saborPart}${toppingPart}${obsText} x${i.cantidad}`;
}).join('; ');

const codes = mockOrder.items.map(i => i.codigo || '').join('; ');

let totalMonto = 0;
mockOrder.items.forEach(i => {
    const precioBase = (i.precio || 0) * (i.cantidad || 1);
    const precioToppings = (i.toppings || []).reduce((sum, t) => {
        return sum + (Number(t.Precio_Venta || t.Precio || 0) * (i.cantidad || 1));
    }, 0);
    totalMonto += precioBase + precioToppings;
});

// ============================================================================
// MOSTRAR INFORMACIÓN VISUAL
// ============================================================================

console.log('🛒 RESUMEN DEL CARRITO:\n');

mockOrder.items.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.nombre} x${item.cantidad}`);
    console.log(`   Código: ${item.codigo}`);
    console.log(`   Precio base: $${item.precio.toLocaleString('es-CO')} × ${item.cantidad} = $${(item.precio * item.cantidad).toLocaleString('es-CO')}`);
    
    if (item.sabores && item.sabores.length) {
        console.log(`   Sabores: ${item.sabores.map(s => s.NombreProducto).join(', ')}`);
    }
    
    if (item.toppings && item.toppings.length) {
        console.log(`   Toppings:`);
        item.toppings.forEach(t => {
            const precioTopping = Number(t.Precio_Venta || 0);
            const totalTopping = precioTopping * item.cantidad;
            console.log(`     - ${t.NombreProducto}: $${precioTopping.toLocaleString('es-CO')} × ${item.cantidad} = $${totalTopping.toLocaleString('es-CO')}`);
        });
    }
    
    if (item.observaciones) {
        console.log(`   Observaciones: ${item.observaciones}`);
    }
    
    const precioBase = item.precio * item.cantidad;
    const precioToppings = (item.toppings || []).reduce((sum, t) => {
        return sum + (Number(t.Precio_Venta || 0) * item.cantidad);
    }, 0);
    const subtotal = precioBase + precioToppings;
    
    console.log(`   Subtotal: $${subtotal.toLocaleString('es-CO')}`);
    console.log('');
});

console.log('💰 TOTAL DEL PEDIDO: $' + totalMonto.toLocaleString('es-CO'));
console.log('\n' + '='.repeat(80) + '\n');

// ============================================================================
// MOSTRAR CÓMO SE VERÁ EN EL SHEET
// ============================================================================

console.log('📋 VISTA PREVIA DEL GOOGLE SHEET:\n');
console.log('   (Así se verá en la hoja "Entregas")\n');

const sheetPreview = [
    { col: 'A', name: 'Fecha', value: new Date().toISOString().replace('T', ' ').substring(0, 19) },
    { col: 'B', name: 'Nombre', value: 'TEST - Validación Sheets' },
    { col: 'C', name: 'Producto', value: productsText, critical: true },
    { col: 'D', name: 'Código', value: codes, critical: true },
    { col: 'E', name: 'Teléfono', value: '3001234567' },
    { col: 'F', name: 'Dirección', value: 'Cra 23 #10-05 - TEST VALIDACIÓN' },
    { col: 'G', name: 'Monto', value: totalMonto, critical: true },
    { col: 'H', name: 'Pago', value: 'efectivo' },
    { col: 'I', name: 'Estado', value: 'TEST - Por validar' },
    { col: 'J', name: 'Observaciones', value: 'Origen: WhatsApp Bot - TEST | Cliente JID: test@s.whatsapp.net' }
];

sheetPreview.forEach(row => {
    const marker = row.critical ? '⚠️  CRÍTICO' : '';
    console.log(`   Columna ${row.col} (${row.name}): ${marker}`);
    
    if (typeof row.value === 'string' && row.value.length > 100) {
        console.log(`   "${row.value.substring(0, 100)}..."`);
        console.log(`   (Total: ${row.value.length} caracteres)`);
    } else {
        console.log(`   "${row.value}"`);
    }
    
    console.log('');
});

console.log('='.repeat(80) + '\n');

// ============================================================================
// ANÁLISIS DE CAMPOS CRÍTICOS
// ============================================================================

console.log('🔍 ANÁLISIS DETALLADO DE CAMPOS CRÍTICOS:\n');

console.log('1️⃣  COLUMNA C - PRODUCTO:\n');
console.log('   Longitud: ' + productsText.length + ' caracteres');
console.log('   Productos incluidos: ' + mockOrder.items.length);
console.log('   Separador: ";"');
console.log('   Contiene sabores: ' + (productsText.includes('Sabores:') ? '✅ SÍ' : '❌ NO'));
console.log('   Contiene toppings: ' + (productsText.includes('Toppings:') ? '✅ SÍ' : '❌ NO'));
console.log('   Contiene cantidades: ' + (productsText.includes('x') ? '✅ SÍ' : '❌ NO'));
console.log('   Valor:');
console.log('   "' + productsText + '"');
console.log('');

console.log('2️⃣  COLUMNA D - CÓDIGO:\n');
console.log('   Longitud: ' + codes.length + ' caracteres');
console.log('   Códigos incluidos: ' + codes.split('; ').length);
console.log('   Separador: ";"');
console.log('   Valor:');
console.log('   "' + codes + '"');
console.log('');

console.log('3️⃣  COLUMNA G - MONTO:\n');
console.log('   Tipo: ' + typeof totalMonto);
console.log('   Valor numérico: ' + totalMonto);
console.log('   Valor formateado: $' + totalMonto.toLocaleString('es-CO'));
console.log('   Desglose:');
mockOrder.items.forEach((item, idx) => {
    const precioBase = item.precio * item.cantidad;
    const precioToppings = (item.toppings || []).reduce((sum, t) => {
        return sum + (Number(t.Precio_Venta || 0) * item.cantidad);
    }, 0);
    const subtotal = precioBase + precioToppings;
    console.log(`   - ${item.nombre} x${item.cantidad}: $${subtotal.toLocaleString('es-CO')}`);
});
console.log(`   TOTAL: $${totalMonto.toLocaleString('es-CO')}`);
console.log('');

console.log('='.repeat(80) + '\n');

// ============================================================================
// VALIDACIONES
// ============================================================================

console.log('✅ VALIDACIONES:\n');

const validations = [
    { 
        check: productsText.length > 0, 
        name: 'Campo "producto" no está vacío',
        critical: true
    },
    { 
        check: !productsText.includes('undefined') && !productsText.includes('null'), 
        name: 'Campo "producto" no contiene undefined/null',
        critical: true
    },
    { 
        check: codes.length > 0, 
        name: 'Campo "codigo" no está vacío',
        critical: true
    },
    { 
        check: !codes.includes('undefined') && !codes.includes('null'), 
        name: 'Campo "codigo" no contiene undefined/null',
        critical: true
    },
    { 
        check: totalMonto > 0, 
        name: 'Campo "monto" es mayor que 0',
        critical: true
    },
    { 
        check: typeof totalMonto === 'number', 
        name: 'Campo "monto" es un número',
        critical: true
    },    { 
        check: productsText.length > 0 && !productsText.includes('undefined'), 
        name: `Campo "producto" contiene los ${mockOrder.items.length} productos`,
        critical: true
    },
    { 
        check: codes.split('; ').length === mockOrder.items.length, 
        name: `Cantidad de códigos coincide (${mockOrder.items.length})`,
        critical: true
    }
];

let allPassed = true;

validations.forEach(v => {
    const status = v.check ? '✅' : '❌';
    const critical = v.critical ? ' [CRÍTICO]' : '';
    console.log(`   ${status} ${v.name}${critical}`);
    if (!v.check) allPassed = false;
});

console.log('\n' + '='.repeat(80) + '\n');

if (allPassed) {
    console.log('🎉 TODAS LAS VALIDACIONES PASARON ✅\n');
    console.log('   El payload está listo para enviarse al backend.');
    console.log('   Ejecuta: node test_send_to_sheet.js\n');
} else {
    console.log('❌ ALGUNAS VALIDACIONES FALLARON\n');
    console.log('   Revisa los campos marcados arriba antes de enviar.\n');
}

console.log('='.repeat(80) + '\n');

console.log('📚 PRÓXIMOS PASOS:\n');
console.log('   1. Si todo se ve correcto, ejecuta:');
console.log('      node test_send_to_sheet.js\n');
console.log('   2. Eso enviará este payload al backend\n');
console.log('   3. Luego verifica en Google Sheets que las columnas estén llenas\n');
console.log('   4. Lee la guía completa:');
console.log('      SHEET_VALIDATION_CHECKLIST.md\n');
