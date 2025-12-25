#!/usr/bin/env node
'use strict';

/**
 * TEST: Verificar configuración de administradores y notificaciones
 * 
 * Este script verifica que:
 * 1. El archivo .env existe y está configurado
 * 2. Los ADMIN_JIDS están definidos correctamente
 * 3. Las notificaciones a admin funcionan
 */

// Cargar .env
require('dotenv').config();

console.log('\n' + '='.repeat(70));
console.log('🧪 TEST: Configuración de Administradores');
console.log('='.repeat(70) + '\n');

// Verificar que .env existe
const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');

console.log('📋 PASO 1: Verificar archivo .env\n');

if (!fs.existsSync(envPath)) {
    console.log('❌ ERROR: El archivo .env NO existe\n');
    console.log('💡 SOLUCIÓN:');
    console.log('   1. Copia el archivo de plantilla:');
    console.log('      Copy-Item .env.example .env\n');
    console.log('   2. Edita .env y configura tus JIDs reales:');
    console.log('      ADMIN_JID=573XXXXXXXXX@s.whatsapp.net');
    console.log('      SOCIA_JID=573XXXXXXXXX@s.whatsapp.net');
    console.log('      ADMIN_JIDS=573XXX...@s.whatsapp.net,573XXX...@s.whatsapp.net\n');
    process.exit(1);
}

console.log('✅ Archivo .env existe\n');

// Mostrar variables cargadas
console.log('📋 PASO 2: Variables de entorno cargadas desde .env\n');

console.log('   ADMIN_JID:', process.env.ADMIN_JID || '❌ NO CONFIGURADO');
console.log('   SOCIA_JID:', process.env.SOCIA_JID || '❌ NO CONFIGURADO');
console.log('   ADMIN_JIDS:', process.env.ADMIN_JIDS || '❌ NO CONFIGURADO');
console.log('');

// Validar formato
console.log('📋 PASO 3: Validar formato de JIDs\n');

const adminJid = process.env.ADMIN_JID;
const sociaJid = process.env.SOCIA_JID;
const adminJids = process.env.ADMIN_JIDS;

let hasErrors = false;

// Función para validar formato de JID
function isValidJid(jid) {
    if (!jid) return false;
    // Formato: 573XXXXXXXXX@s.whatsapp.net
    const jidRegex = /^[0-9]{10,15}@s\.whatsapp\.net$/;
    return jidRegex.test(jid);
}

// Validar ADMIN_JID
if (!adminJid || adminJid.includes('XXXXX')) {
    console.log('   ❌ ADMIN_JID no está configurado o contiene XXXXX');
    hasErrors = true;
} else if (!isValidJid(adminJid)) {
    console.log(`   ❌ ADMIN_JID tiene formato inválido: "${adminJid}"`);
    console.log('      Formato esperado: 573XXXXXXXXX@s.whatsapp.net');
    hasErrors = true;
} else {
    console.log('   ✅ ADMIN_JID válido:', adminJid);
}

// Validar SOCIA_JID
if (!sociaJid || sociaJid.includes('XXXXX')) {
    console.log('   ⚠️  SOCIA_JID no está configurado (opcional)');
} else if (!isValidJid(sociaJid)) {
    console.log(`   ❌ SOCIA_JID tiene formato inválido: "${sociaJid}"`);
    console.log('      Formato esperado: 573XXXXXXXXX@s.whatsapp.net');
    hasErrors = true;
} else {
    console.log('   ✅ SOCIA_JID válido:', sociaJid);
}

// Validar ADMIN_JIDS
if (!adminJids || adminJids.includes('XXXXX')) {
    console.log('   ❌ ADMIN_JIDS no está configurado o contiene XXXXX');
    hasErrors = true;
} else {
    const jids = adminJids.split(',').map(j => j.trim()).filter(Boolean);
    console.log(`   📋 ADMIN_JIDS contiene ${jids.length} administrador(es):`);
    
    jids.forEach((jid, idx) => {
        if (isValidJid(jid)) {
            console.log(`      ${idx + 1}. ✅ ${jid}`);
        } else {
            console.log(`      ${idx + 1}. ❌ ${jid} (formato inválido)`);
            hasErrors = true;
        }
    });
}

console.log('');

// Verificar que checkoutHandler puede leer los admins
console.log('📋 PASO 4: Probar función getAdminJids()\n');

try {
    // Limpiar caché para forzar recarga
    delete require.cache[require.resolve('./services/checkoutHandler')];
    
    const { getAdminJids } = require('./services/checkoutHandler');
    const admins = getAdminJids();
    
    if (!admins || admins.length === 0) {
        console.log('   ❌ getAdminJids() retorna array vacío');
        console.log('      Esto significa que las notificaciones NO se enviarán\n');
        hasErrors = true;
    } else {
        console.log(`   ✅ getAdminJids() retorna ${admins.length} admin(s):`);
        admins.forEach((jid, idx) => {
            console.log(`      ${idx + 1}. ${jid}`);
        });
        console.log('');
    }
} catch (error) {
    console.log('   ❌ Error al cargar checkoutHandler:', error.message);
    hasErrors = true;
}

// Resultado final
console.log('='.repeat(70) + '\n');

if (hasErrors) {
    console.log('❌ CONFIGURACIÓN INCORRECTA\n');
    console.log('💡 PASOS PARA CORREGIR:\n');
    console.log('1. Abre el archivo .env en VS Code:');
    console.log('   code .env\n');
    console.log('2. Configura tus JIDs reales (sin XXXXX):\n');
    console.log('   ADMIN_JID=573001234567@s.whatsapp.net');
    console.log('   SOCIA_JID=573007654321@s.whatsapp.net');
    console.log('   ADMIN_JIDS=573001234567@s.whatsapp.net,573007654321@s.whatsapp.net\n');
    console.log('3. Vuelve a ejecutar este test:');
    console.log('   node test_admin_config.js\n');
    console.log('📚 GUÍA COMPLETA: Revisa el archivo .env para instrucciones\n');
    process.exit(1);
} else {
    console.log('✅ CONFIGURACIÓN CORRECTA\n');
    console.log('🎉 Las notificaciones a administradores están listas!\n');
    console.log('📋 PRÓXIMOS PASOS:\n');
    console.log('1. Inicia el bot:');
    console.log('   npm start\n');
    console.log('2. Prueba enviar "asdasd" desde WhatsApp');
    console.log('3. Verifica que recibes la notificación de error\n');
    process.exit(0);
}
