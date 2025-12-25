#!/usr/bin/env node
'use strict';

/**
 * TEST: Enviar pedido de prueba a Google Sheets
 * 
 * Este test envía un pedido real al endpoint del backend
 * para validar que los campos 'producto' y 'codigo' (singular)
 * lleguen correctamente al Google Sheet.
 * 
 * ⚙️  PREREQUISITOS:
 * 1. Tener el backend corriendo en http://localhost:8001
 * 2. Asegurarse de que el endpoint /registrar_entrega/ esté disponible
 * 
 * 🚀 CÓMO EJECUTAR:
 * 1. En una terminal, inicia el backend: cd ../API_inventario && python manage.py runserver 8001
 * 2. En otra terminal, ejecuta este test: node test_send_to_sheet.js
 */

const axios = require('axios');

// Configuración del endpoint (mismo que usa el bot)
// ⚠️  ACTUALIZADO: Usar servidor local puerto 8001 (Railway devuelve 404)
const API_BASE = process.env.API_BASE || 'http://localhost:8001';
const ENDPOINT = '/api/registrar_entrega/'; // ← Incluye prefijo /api/

console.log('\n🧪 === TEST: Envío a Google Sheets ===\n');
console.log(`📍 Endpoint: ${API_BASE}${ENDPOINT}`);
console.log('⚙️  Usando servidor LOCAL (puerto 8001)\n');

// ============================================================================
// CONSTRUIR PAYLOAD EXACTAMENTE COMO LO HACE handleFinalizeOrder
// ============================================================================

// Simular un pedido REAL con MÚLTIPLES productos
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

// ✅ CONSTRUIR PRODUCTO: Concatenar todos con sabores y toppings
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

// ✅ CONSTRUIR CÓDIGO: Concatenar todos los códigos
const codes = mockOrder.items.map(i => i.codigo || '').join('; ');

// ✅ CALCULAR TOTAL: Precio base + toppings
let totalMonto = 0;
mockOrder.items.forEach(i => {
    const precioBase = (i.precio || 0) * (i.cantidad || 1);
    const precioToppings = (i.toppings || []).reduce((sum, t) => {
        return sum + (Number(t.Precio_Venta || t.Precio || 0) * (i.cantidad || 1));
    }, 0);
    totalMonto += precioBase + precioToppings;
});

// ✅ PAYLOAD FINAL (EXACTO al de checkoutHandler.js)
const testPayload = {
    fecha: new Date().toISOString(),
    nombre: 'TEST - Validación Sheets',
    
    // ✅ CAMPOS CRÍTICOS (SINGULAR como espera el backend)
    producto: productsText,  // ← Todos los productos concatenados
    codigo: codes,            // ← Todos los códigos concatenados
    
    telefono: '3001234567',
    direccion: 'Cra 23 #10-05 - TEST VALIDACIÓN',
    monto: totalMonto,        // ← Total calculado
    pago: 'efectivo',
    estado: 'TEST - Por validar',
    observaciones: 'Origen: WhatsApp Bot - TEST | Cliente JID: test@s.whatsapp.net',
    
    // Detalles adicionales (no van al sheet, solo para admin)
    detalles_items: mockOrder.items.map(i => ({
        codigo: i.codigo,
        nombre: i.nombre,
        cantidad: i.cantidad,
        precio: i.precio,
        sabores: i.sabores.map(s => s.NombreProducto || s),
        toppings: i.toppings.map(t => ({
            nombre: t.NombreProducto || t,
            precio: Number(t.Precio_Venta || t.Precio || 0)
        })),
        observaciones: i.observaciones
    }))
};

console.log('📦 RESUMEN DEL PEDIDO DE PRUEBA:\n');
console.log('   🛒 Productos en el carrito: ' + mockOrder.items.length);
mockOrder.items.forEach((item, idx) => {
    console.log(`   ${idx + 1}. ${item.nombre} x${item.cantidad}`);
    console.log(`      - Sabores: ${item.sabores.map(s => s.NombreProducto).join(', ')}`);
    console.log(`      - Toppings: ${item.toppings.length > 0 ? item.toppings.map(t => t.NombreProducto).join(', ') : 'Ninguno'}`);
    if (item.observaciones) {
        console.log(`      - Observaciones: ${item.observaciones}`);
    }
});
console.log('\n   💰 TOTAL A PAGAR: $' + totalMonto.toLocaleString('es-CO'));
console.log('\n' + ''.padEnd(70, '-') + '\n');

console.log('📋 PAYLOAD QUE SE ENVIARÁ AL BACKEND:\n');
console.log('   producto (concatenado):');
console.log('   "' + testPayload.producto + '"\n');
console.log('   codigo (concatenado):');
console.log('   "' + testPayload.codigo + '"\n');
console.log('   monto:');
console.log('   ' + testPayload.monto + '\n');
console.log(''.padEnd(70, '-') + '\n');

// Validar que NO tiene campos en plural
if (testPayload.productos || testPayload.codigos) {
    console.error('❌ ERROR: El payload tiene campos en PLURAL (productos/codigos)');
    console.error('   Esto causará que lleguen vacíos al sheet');
    process.exit(1);
}

// Validar que tiene campos en singular
if (!testPayload.producto || !testPayload.codigo) {
    console.error('❌ ERROR: El payload NO tiene campos en SINGULAR (producto/codigo)');
    process.exit(1);
}

// Validar que el monto sea correcto
if (!testPayload.monto || testPayload.monto <= 0) {
    console.error('❌ ERROR: El campo "monto" está vacío o es 0');
    process.exit(1);
}

console.log('✅ Validación de estructura: OK');
console.log('   - Campo "producto" (singular): ✅ (' + testPayload.producto.length + ' caracteres)');
console.log('   - Campo "codigo" (singular): ✅ (' + testPayload.codigo.length + ' caracteres)');
console.log('   - Campo "monto": ✅ ($' + testPayload.monto.toLocaleString('es-CO') + ')');
console.log('   - NO tiene "productos" (plural): ✅');
console.log('   - NO tiene "codigos" (plural): ✅');
console.log('\n');

// Enviar al backend
async function sendTestOrder() {
    try {
        console.log('📤 Enviando pedido de prueba al backend...\n');
        
        const response = await axios.post(`${API_BASE}${ENDPOINT}`, testPayload, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ RESPUESTA DEL BACKEND:');
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Data:`, JSON.stringify(response.data, null, 2));
          if (response.status === 200 || response.status === 201) {
            console.log('\n🎉 ¡PEDIDO ENVIADO EXITOSAMENTE!');
            console.log('\n📋 VALIDACIÓN EN GOOGLE SHEETS:');
            console.log('   1. Abre el Google Sheet de "Entregas"');
            console.log('   2. Busca la última fila agregada (fecha actual)');
            console.log('   3. Verifica TODAS estas columnas:\n');
            
            console.log('   📌 COLUMNA A (Fecha):');
            console.log('      Debe contener la fecha/hora actual\n');
            
            console.log('   📌 COLUMNA B (Nombre):');
            console.log('      Esperado: "TEST - Validación Sheets"\n');
            
            console.log('   📌 COLUMNA C (Producto): ⚠️  CRÍTICO');
            console.log('      Esperado (concatenación de TODOS los productos):');
            console.log('      "Copa Tormenta de Chocolate (Sabores: Chocolate, Brownie, Arequipe) (Toppings: chocolatina wafer jet, galletas oreo); Observaciones: Sin lactosa x2; Malteada Fresa con Chocolate (Sabores: Fresa, Chocolate) x1; Sundae Genérico (Sabores: Vainilla) (Toppings: M&M) x1"');
            console.log('      ✓ Debe incluir TODOS los productos');
            console.log('      ✓ Cada producto con sus sabores entre paréntesis');
            console.log('      ✓ Cada producto con sus toppings entre paréntesis');
            console.log('      ✓ Observaciones si las hay');
            console.log('      ✓ Cantidad al final (x2, x1, etc.)');
            console.log('      ✓ Separados por punto y coma (;)\n');
            
            console.log('   📌 COLUMNA D (Código): ⚠️  CRÍTICO');
            console.log('      Esperado: "CI-TOR-CHOC; MA-FRE-CHOC; SU-GEN"');
            console.log('      ✓ Debe incluir TODOS los códigos');
            console.log('      ✓ Separados por punto y coma (;)\n');
            
            console.log('   📌 COLUMNA E (Teléfono):');
            console.log('      Esperado: "3001234567"\n');
            
            console.log('   📌 COLUMNA F (Dirección):');
            console.log('      Esperado: "Cra 23 #10-05 - TEST VALIDACIÓN"\n');
            
            console.log('   📌 COLUMNA G (Monto): ⚠️  CRÍTICO');
            console.log('      Esperado: ' + totalMonto);
            console.log('      Cálculo:');
            console.log('        - Copa x2: (9000 + 2500 + 2500) x 2 = 28000');
            console.log('        - Malteada x1: 7500 x 1 = 7500');
            console.log('        - Sundae x1: (6000 + 2000) x 1 = 8000');
            console.log('        - TOTAL: ' + totalMonto);
            console.log('      ✓ Debe ser el total exacto incluyendo toppings\n');
            
            console.log('   📌 COLUMNA H (Pago):');
            console.log('      Esperado: "efectivo"\n');
            
            console.log('   📌 COLUMNA I (Estado):');
            console.log('      Esperado: "TEST - Por validar"\n');
            
            console.log('   📌 COLUMNA J (Observaciones):');
            console.log('      Esperado: "Origen: WhatsApp Bot - TEST | Cliente JID: test@s.whatsapp.net"\n');
            
            console.log(''.padEnd(70, '='));
            console.log('\n🎯 RESULTADO ESPERADO:\n');
            console.log('   ✅ TODAS las columnas con texto completo → FIX EXITOSO ✅');
            console.log('   ❌ Alguna columna vacía o incorrecta → Problema persiste\n');
            console.log(''.padEnd(70, '='));
            
            return true;
        } else {
            console.error('⚠️  Respuesta inesperada del servidor');
            return false;
        }
        
    } catch (error) {
        console.error('\n❌ ERROR AL ENVIAR PEDIDO:');
        
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('   No se recibió respuesta del servidor');
            console.error(`   Endpoint: ${API_BASE}${ENDPOINT}`);
        } else {
            console.error(`   Error: ${error.message}`);
        }
          console.error('\n💡 POSIBLES CAUSAS:');
        console.error('   1. Servidor backend NO está corriendo en http://localhost:8001');
        console.error('      → Inicia el backend: cd ../API_inventario && python manage.py runserver 8001');
        console.error('   2. Endpoint incorrecto (verifica que sea /registrar_entrega/)');
        console.error('   3. Error en el backend al procesar el payload');
        console.error('   4. Timeout de conexión');
        
        console.error('\n🔧 SOLUCIÓN RECOMENDADA:');
        console.error('   1. Abre una nueva terminal');
        console.error('   2. cd ../API_inventario');
        console.error('   3. python manage.py runserver 8001');
        console.error('   4. Vuelve a ejecutar este test: node test_send_to_sheet.js');
        
        return false;
    }
}

// Ejecutar test
sendTestOrder()
    .then(success => {
        if (success) {
            console.log('\n✅ Test completado exitosamente');
            process.exit(0);
        } else {
            console.error('\n❌ Test falló');
            process.exit(1);
        }
    })
    .catch(err => {
        console.error('\n💥 Error crítico:', err.message);
        process.exit(1);
    });
