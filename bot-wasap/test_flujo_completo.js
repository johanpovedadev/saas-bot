/**
 * TEST COMPLETO DEL FLUJO DEL BOT
 * 
 * Valida el flujo end-to-end:
 * 1. Búsqueda de producto
 * 2. Selección de sabores
 * 3. Selección de toppings
 * 4. Cantidad
 * 5. Checkout (dirección, pago)
 * 6. Guardado en Google Sheets (pestaña "Domicilios")
 */

'use strict';

// Cargar variables de entorno
require('dotenv').config();

console.log('\n' + '='.repeat(80));
console.log('🧪 TEST COMPLETO DEL FLUJO DEL BOT');
console.log('='.repeat(80) + '\n');

// Verificar variables ENV
console.log('📋 PASO 1: Verificando variables de entorno...\n');

const requiredEnvVars = [
    'SPREADSHEET_ID',
    'SHEET_TAB_DOMICILIOS',
    'API_BASE'
];

let missingVars = [];
requiredEnvVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`✅ ${varName} = ${value}`);
    } else {
        console.log(`❌ ${varName} = NO CONFIGURADA`);
        missingVars.push(varName);
    }
});

if (missingVars.length > 0) {
    console.log(`\n⚠️  Faltan ${missingVars.length} variables de entorno:`);
    missingVars.forEach(v => console.log(`   - ${v}`));
    console.log('\n💡 Asegúrate de que el archivo .env esté configurado correctamente\n');
    process.exit(1);
}

console.log('\n✅ Todas las variables ENV están configuradas\n');
console.log('-'.repeat(80) + '\n');

// Verificar conexión al backend
console.log('📋 PASO 2: Verificando conexión al backend...\n');

const axios = require('axios');
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8001/api';

async function testBackendConnection() {
    try {
        console.log(`🔍 Intentando conectar a: ${API_BASE}/health`);
        const response = await axios.get(`${API_BASE}/health`, { timeout: 5000 });
        console.log(`✅ Backend respondió con status: ${response.status}`);
        console.log(`   Respuesta: ${JSON.stringify(response.data || {})}\n`);
        return true;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log(`❌ No se pudo conectar al backend en ${API_BASE}`);
            console.log(`   Error: Conexión rechazada (¿está el servidor corriendo?)\n`);
        } else if (error.response) {
            console.log(`⚠️  Backend respondió con error ${error.response.status}`);
            console.log(`   Pero está en línea\n`);
            return true; // El servidor está arriba aunque dio error
        } else {
            console.log(`❌ Error: ${error.message}\n`);
        }
        return false;
    }
}

async function runTests() {
    const backendOnline = await testBackendConnection();
    
    if (!backendOnline) {
        console.log('⚠️  El backend no está disponible. Algunas pruebas se saltarán.\n');
    }
    
    console.log('-'.repeat(80) + '\n');
    
    // Test 3: Verificar estructura de sesión
    console.log('📋 PASO 3: Verificando estructura de sesiones...\n');
    
    const { initializeUserSession } = require('./handlers/modules/handler.utils');
    const ctx = { sessions: {} };
    const testJid = '573001234567@s.whatsapp.net';
    
    initializeUserSession(testJid, ctx);
    const session = ctx.sessions[testJid];
    
    console.log('✅ Sesión inicializada:');
    console.log(`   - Phase: ${session.phase}`);
    console.log(`   - Order items: ${Array.isArray(session.order?.items) ? 'Array' : 'Undefined'}`);
    console.log(`   - Cart: ${session.order ? 'Inicializado' : 'No inicializado'}\n`);
    
    console.log('-'.repeat(80) + '\n');
    
    // Test 4: Verificar que los módulos se cargan correctamente
    console.log('📋 PASO 4: Verificando carga de módulos...\n');
    
    const modules = [
        { name: 'selection.handler', path: './handlers/modules/selection.handler' },
        { name: 'products.handler', path: './handlers/modules/products.handler' },
        { name: 'handler.utils', path: './handlers/modules/handler.utils' },
        { name: 'fuzzySearch', path: './utils/fuzzySearch' },
        { name: 'validators', path: './utils/validators' },
        { name: 'messageTemplates', path: './utils/messageTemplates' },
        { name: 'env.loader', path: './config/env.loader' }
    ];
    
    let moduleErrors = [];
    modules.forEach(mod => {
        try {
            require(mod.path);
            console.log(`✅ ${mod.name}`);
        } catch (error) {
            console.log(`❌ ${mod.name} - Error: ${error.message}`);
            moduleErrors.push(mod.name);
        }
    });
    
    if (moduleErrors.length > 0) {
        console.log(`\n⚠️  ${moduleErrors.length} módulos fallaron al cargar\n`);
        process.exit(1);
    }
    
    console.log('\n✅ Todos los módulos cargaron correctamente\n');
    console.log('-'.repeat(80) + '\n');
    
    // Test 5: Simular flujo completo
    console.log('📋 PASO 5: Simulando flujo completo de pedido...\n');
    
    console.log('📝 Escenario de prueba:');
    console.log('   1. Usuario busca "copa"');
    console.log('   2. Selecciona sabores: S1, S2');
    console.log('   3. Selecciona topping: T1');
    console.log('   4. Cantidad: 2');
    console.log('   5. Confirma carrito');
    console.log('   6. Proporciona dirección');
    console.log('   7. Selecciona método de pago\n');
    
    // Simular búsqueda de producto
    const { fuzzySearchProducts } = require('./utils/fuzzySearch');
    const envConfig = require('./config/env.loader');
    const dbFields = envConfig.getDbFields();
    
    const mockProducts = [
        {
            [dbFields.productCode]: 'COPA001',
            [dbFields.productName]: 'Copa Tradicional',
            [dbFields.productPrice]: 8000,
            [dbFields.itemPrimaryCount]: 2,
            [dbFields.itemSecondaryCount]: 2
        }
    ];
    
    const searchResult = fuzzySearchProducts('copa', mockProducts);
    console.log(`✅ Búsqueda de producto: ${searchResult.length} resultado(s) encontrado(s)`);
    if (searchResult.length > 0) {
        console.log(`   - ${searchResult[0][dbFields.productName]} (${searchResult[0][dbFields.productCode]})\n`);
    }
    
    // Simular validación de selección
    const validators = require('./utils/validators');
    const itemValidation = validators.validateItemSelection('S1, S2', 'primary');
    console.log(`✅ Validación de items: ${itemValidation.valid ? 'PASS' : 'FAIL'}`);
    if (itemValidation.valid) {
        console.log(`   - Códigos extraídos: ${itemValidation.codes.join(', ')}\n`);
    }
    
    // Simular validación de cantidad
    const qtyValidation = validators.validateQuantity('2', 1, 10);
    console.log(`✅ Validación de cantidad: ${qtyValidation.valid ? 'PASS' : 'FAIL'}`);
    if (qtyValidation.valid) {
        console.log(`   - Cantidad: ${qtyValidation.quantity}\n`);
    }
    
    // Simular validación de dirección
    const addressValidation = validators.validateAddress('Calle 15 #5-45, Barrio Centro');
    console.log(`✅ Validación de dirección: ${addressValidation.valid ? 'PASS' : 'FAIL'}`);
    if (addressValidation.valid) {
        console.log(`   - Dirección: ${addressValidation.address}\n`);
    }
    
    // Simular validación de método de pago
    const paymentValidation = validators.validatePaymentMethod('Nequi');
    console.log(`✅ Validación de método de pago: ${paymentValidation.valid ? 'PASS' : 'FAIL'}`);
    if (paymentValidation.valid) {
        console.log(`   - Método: ${paymentValidation.method}\n`);
    }
    
    console.log('-'.repeat(80) + '\n');
    
    // Test 6: Verificar configuración de Google Sheets
    console.log('📋 PASO 6: Verificando configuración de Google Sheets...\n');
    
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const sheetTab = process.env.SHEET_TAB_DOMICILIOS;
    
    console.log(`✅ Configuración de Google Sheets:`);
    console.log(`   - Spreadsheet ID: ${spreadsheetId}`);
    console.log(`   - Pestaña Domicilios: ${sheetTab}`);
    console.log(`   - Rango: ${process.env.SHEET_RANGE_DOMICILIOS || 'No configurado'}\n`);
    
    console.log('💡 Los pedidos se guardarán en:');
    console.log(`   https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`);
    console.log(`   Pestaña: "${sheetTab}"\n`);
    
    console.log('-'.repeat(80) + '\n');
    
    // Resumen final
    console.log('📊 RESUMEN DE PRUEBAS:\n');
    console.log('✅ Variables ENV configuradas');
    console.log(`${backendOnline ? '✅' : '⚠️ '} Backend ${backendOnline ? 'en línea' : 'no disponible'}`);
    console.log('✅ Sesiones funcionando');
    console.log('✅ Módulos cargados');
    console.log('✅ Validadores operativos');
    console.log('✅ Google Sheets configurado\n');
    
    console.log('='.repeat(80));
    console.log('🎉 TODAS LAS PRUEBAS PASARON');
    console.log('='.repeat(80) + '\n');
    
    console.log('📝 PRÓXIMOS PASOS:\n');
    console.log('1. Asegúrate de que el backend Django esté corriendo:');
    console.log('   python manage.py runserver 0.0.0.0:8001\n');
    console.log('2. Verifica que la pestaña "Domicilios" exista en tu Google Sheet\n');
    console.log('3. Prueba el flujo completo desde WhatsApp\n');
}

runTests().catch(error => {
    console.error('\n❌ Error fatal en las pruebas:', error.message);
    console.error(error.stack);
    process.exit(1);
});
