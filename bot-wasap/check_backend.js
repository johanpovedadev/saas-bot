#!/usr/bin/env node
'use strict';

/**
 * HELPER: Verificar si el backend está corriendo
 * 
 * Este script verifica que el backend esté disponible en localhost:8001
 * antes de ejecutar el test de Google Sheets.
 */

const axios = require('axios');

const BACKEND_URL = 'http://localhost:8001';
const HEALTH_ENDPOINTS = [
    '/api/registrar_entrega/',
    '/admin/',
    '/api/'
];

async function checkBackend() {
    console.log('🔍 Verificando disponibilidad del backend...\n');
    console.log(`📍 URL: ${BACKEND_URL}\n`);

    let backendAvailable = false;

    // Intentar varios endpoints
    for (const endpoint of HEALTH_ENDPOINTS) {
        try {
            console.log(`   Probando: ${BACKEND_URL}${endpoint}`);
            
            const response = await axios.get(`${BACKEND_URL}${endpoint}`, {
                timeout: 3000,
                validateStatus: (status) => status < 500 // Aceptar 200-499
            });

            console.log(`   ✅ Respuesta: ${response.status}`);
            backendAvailable = true;
            break;

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.log(`   ❌ Conexión rechazada`);
            } else if (error.code === 'ETIMEDOUT') {
                console.log(`   ⏱️  Timeout`);
            } else {
                console.log(`   ⚠️  Error: ${error.message}`);
            }
        }
    }

    console.log('\n' + '='.repeat(60) + '\n');

    if (backendAvailable) {
        console.log('✅ BACKEND DISPONIBLE\n');
        console.log('🚀 Puedes ejecutar el test con:');
        console.log('   node test_send_to_sheet.js\n');
        return true;
    } else {
        console.log('❌ BACKEND NO DISPONIBLE\n');
        console.log('💡 Para iniciar el backend:');
        console.log('   1. Abre una nueva terminal');
        console.log('   2. cd ../API_inventario');
        console.log('   3. python manage.py runserver 8001\n');
        console.log('⏳ Luego vuelve a ejecutar:');
        console.log('   node check_backend.js\n');
        return false;
    }
}

// Ejecutar verificación
checkBackend()
    .then(available => {
        process.exit(available ? 0 : 1);
    })
    .catch(err => {
        console.error('💥 Error crítico:', err.message);
        process.exit(1);
    });
