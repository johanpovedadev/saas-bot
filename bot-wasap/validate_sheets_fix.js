#!/usr/bin/env node
'use strict';

/**
 * FLUJO COMPLETO: Validación del Fix de Google Sheets
 * 
 * Este script ejecuta automáticamente:
 * 1. Verificación del backend
 * 2. Test del payload (sin backend)
 * 3. Test de envío real al backend
 * 4. Instrucciones de validación en Sheets
 */

const { spawn } = require('child_process');
const axios = require('axios');

const BACKEND_URL = 'http://localhost:8001';

console.log('\n' + '='.repeat(70));
console.log('🧪 VALIDACIÓN COMPLETA: Fix de Productos/Códigos en Google Sheets');
console.log('='.repeat(70) + '\n');

// PASO 1: Verificar backend
async function step1_checkBackend() {
    console.log('📋 PASO 1/4: Verificando backend...\n');

    try {
        const response = await axios.get(`${BACKEND_URL}/`, {
            timeout: 3000,
            validateStatus: (status) => status < 500
        });

        console.log(`✅ Backend disponible (HTTP ${response.status})\n`);
        return true;

    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log('❌ Backend NO está corriendo\n');
            console.log('💡 Para continuar, inicia el backend:');
            console.log('   1. Abre una nueva terminal');
            console.log('   2. cd ../API_inventario');
            console.log('   3. python manage.py runserver 8001\n');
            console.log('⏸️  PAUSADO: Ejecuta este script nuevamente cuando el backend esté listo.\n');
            return false;
        }

        console.log(`⚠️  Error al verificar backend: ${error.message}\n`);
        return false;
    }
}

// PASO 2: Test del payload (sin backend)
function step2_testPayload() {
    return new Promise((resolve) => {
        console.log('📋 PASO 2/4: Validando estructura del payload...\n');

        const test = spawn('node', ['test_payload_backend.js'], {
            cwd: __dirname,
            stdio: 'inherit'
        });

        test.on('close', (code) => {
            if (code === 0) {
                console.log('\n✅ Payload válido\n');
                resolve(true);
            } else {
                console.log('\n❌ Error en validación de payload\n');
                resolve(false);
            }
        });
    });
}

// PASO 3: Test de envío real
function step3_sendToBackend() {
    return new Promise((resolve) => {
        console.log('📋 PASO 3/4: Enviando pedido de prueba al backend...\n');

        const test = spawn('node', ['test_send_to_sheet.js'], {
            cwd: __dirname,
            stdio: 'inherit'
        });

        test.on('close', (code) => {
            if (code === 0) {
                console.log('\n✅ Pedido enviado exitosamente\n');
                resolve(true);
            } else {
                console.log('\n❌ Error al enviar pedido\n');
                resolve(false);
            }
        });
    });
}

// PASO 4: Instrucciones de validación manual
function step4_instructions() {
    console.log('📋 PASO 4/4: Validación en Google Sheets\n');
    console.log(''.padEnd(70, '-'));
    console.log('🔍 AHORA DEBES VERIFICAR MANUALMENTE:\n');
    console.log('1. Abre el Google Sheet de "Entregas" de Mundo Helados');
    console.log('2. Ve a la ÚLTIMA FILA agregada (fecha de hoy)');
    console.log('3. Verifica estas columnas:\n');
    console.log('   Columna C (Producto):');
    console.log('   ✓ Debe contener el texto completo del producto');
    console.log('   ✓ Ejemplo: "Copa Tormenta de Chocolate (CI-TOR-CHOC) (...)"');
    console.log('');
    console.log('   Columna D (Código):');
    console.log('   ✓ Debe contener el código del producto');
    console.log('   ✓ Ejemplo: "CI-TOR-CHOC"');
    console.log('');
    console.log(''.padEnd(70, '-'));
    console.log('\n🎯 RESULTADO ESPERADO:\n');
    console.log('   ✅ Ambos campos CON TEXTO → Fix exitoso ✅');
    console.log('   ❌ Algún campo VACÍO → Problema persiste\n');
    console.log(''.padEnd(70, '=') + '\n');
}

// Ejecutar flujo completo
async function runFullValidation() {
    try {
        // PASO 1
        const backendOk = await step1_checkBackend();
        if (!backendOk) {
            process.exit(1);
        }

        // PASO 2
        const payloadOk = await step2_testPayload();
        if (!payloadOk) {
            console.log('⚠️  Continuando a pesar del error en payload...\n');
        }

        // PASO 3
        const sendOk = await step3_sendToBackend();
        if (!sendOk) {
            console.log('❌ No se pudo enviar el pedido. Verifica los logs arriba.\n');
            process.exit(1);
        }

        // PASO 4
        step4_instructions();

        process.exit(0);

    } catch (error) {
        console.error('\n💥 Error crítico:', error.message);
        process.exit(1);
    }
}

// Inicio
runFullValidation();
