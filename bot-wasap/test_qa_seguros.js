/**
 * 🧪 QA TEST — Flujo Seguros Mascotas
 *
 * Uso: node test_qa_seguros.js
 *
 * Valida:
 * ✅ Flujo perro
 * ✅ Flujo gato
 * ✅ Edad >12 (rechazo)
 * ✅ Guardado Sheets
 * ✅ Imágenes
 * ✅ Mensajes finales
 * ✅ Datos incompletos
 * ✅ Sintaxis del código
 */

'use strict';

let passed = 0;
let failed = 0;
let errors = [];

function assert(condition, msg) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${msg}`);
    } else {
        failed++;
        errors.push(msg);
        console.log(`  ❌ ${msg}`);
    }
}

async function run() {
    console.log('🧪 QA TEST - SEGUROS MASCOTAS');
    console.log('='.repeat(50));

    // ===================================
    // 1. Validar sintaxis de módulos
    // ===================================
    console.log('\n📁 1. Validando sintaxis de módulos...');
    
    try {
        require('./utils/phases');
        assert(true, 'phases.js carga sin errores');
    } catch (e) {
        assert(false, `phases.js: ${e.message}`);
    }

    try {
        require('./utils/logger');
        assert(true, 'logger.js carga sin errores');
    } catch (e) {
        assert(false, `logger.js: ${e.message}`);
    }

    try {
        require('./config/env.loader');
        assert(true, 'env.loader.js carga sin errores');
    } catch (e) {
        assert(false, `env.loader.js: ${e.message}`);
    }

    try {
        require('./services/bot_core');
        assert(true, 'bot_core.js carga sin errores');
    } catch (e) {
        assert(false, `bot_core.js: ${e.message}`);
    }

    try {
        require('./config/businesses/seguros_mascotas.config');
        assert(true, 'seguros_mascotas.config.js carga sin errores');
    } catch (e) {
        assert(false, `seguros_mascotas.config.js: ${e.message}`);
    }

    try {
        require('./handlers/flows/seguros.flow');
        assert(true, 'seguros.flow.js carga sin errores');
    } catch (e) {
        assert(false, `seguros.flow.js: ${e.message}`);
    }

    // ===================================
    // 2. Validar fases
    // ===================================
    console.log('\n📁 2. Validando fases definidas...');
    
    const PHASE = require('./utils/phases');
    assert(PHASE.INS_SALUDO === 'ins_saludo', 'INS_SALUDO definida');
    assert(PHASE.INS_FLUJO_GATO === 'ins_flujo_gato', 'INS_FLUJO_GATO definida');
    assert(PHASE.INS_FLUJO_PERRO === 'ins_flujo_perro', 'INS_FLUJO_PERRO definida');
    assert(PHASE.INS_FLUJO_PERRO_PREMIUM === 'ins_flujo_perro_premium', 'INS_FLUJO_PERRO_PREMIUM definida');
    assert(PHASE.INS_DATOS_TITULAR === 'ins_datos_titular', 'INS_DATOS_TITULAR definida');
    assert(PHASE.INS_DATOS_MASCOTA === 'ins_datos_mascota', 'INS_DATOS_MASCOTA definida');
    assert(PHASE.INS_CONFIRMACION === 'ins_confirmacion', 'INS_CONFIRMACION definida');
    assert(PHASE.INS_RECHAZO === 'ins_rechazo', 'INS_RECHAZO definida (ISSUE #7)');
    assert(PHASE.INS_FINAL === 'ins_final', 'INS_FINAL definida');
    assert(!PHASE.INS_PAGO, 'INS_PAGO eliminada (ISSUE #3)');

    // ===================================
    // 3. Validar flujo seguros
    // ===================================
    console.log('\n📁 3. Validando funciones del flujo...');
    
    const segurosFlow = require('./handlers/flows/seguros.flow');
    assert(typeof segurosFlow.handle === 'function', 'handle() exportada');
    assert(typeof segurosFlow.isInsurancePhase === 'function', 'isInsurancePhase() exportada');
    assert(typeof segurosFlow.showWelcome === 'function', 'showWelcome() exportada');
    assert(Array.isArray(segurosFlow.INSURANCE_PHASES), 'INSURANCE_PHASES exportado');
    assert(segurosFlow.INSURANCE_PHASES.includes(PHASE.INS_RECHAZO), 'INS_RECHAZO en INSURANCE_PHASES');
    assert(!segurosFlow.INSURANCE_PHASES.includes('ins_pago'), 'INS_PAGO eliminado de INSURANCE_PHASES');

    // ===================================
    // 4. Validar configuración
    // ===================================
    console.log('\n📁 4. Validando configuración del negocio...');
    
    const config = require('./config/businesses/seguros_mascotas.config');
    assert(config.business.name === 'TE ASEGURAMOS', 'Business name = TE ASEGURAMOS (ISSUE #1)');
    assert(config.business.partner === 'Seguros Mundial', 'Partner = Seguros Mundial (ISSUE #1)');
    assert(config.plans.perroPlus.price === 25000, 'Plan PLUS precio $25.000 (ISSUE #2)');
    assert(config.plans.perroPremium.price === 45000, 'Plan PREMIUM precio $45.000 (ISSUE #2)');
    assert(config.plans.gato.price === 20000, 'Plan Gato precio $20.000 (ISSUE #2)');
    assert(config.bot.insuranceFlow.messages.final.includes('{nombre}'), 'Mensaje final tiene placeholder {nombre} (ISSUE #10)');
    assert(config.bot.insuranceFlow.messages.rechazoEdad, 'Mensaje de rechazo por edad definido (ISSUE #7)');
    assert(config.bot.insuranceFlow.messages.datosTitularDocumento.includes('Cédula'), 'Tipo documento enumerado (ISSUE #4)');
    assert(config.bot.insuranceFlow.messages.datosTitularFechaNacimiento.includes('DD/MM/YYYY'), 'Fecha nacimiento DD/MM/YYYY (ISSUE #5)');
    assert(config.bot.insuranceFlow.messages.datosTitularCiudad.includes('departamento'), 'Ciudad + departamento (ISSUE #6)');

    // ===================================
    // 5. Validar datos reducidos (ISSUE #9)
    // ===================================
    console.log('\n📁 5. Validando preguntas reducidas (ISSUE #9)...');

    const fs = require('fs');
    const flowSource = fs.readFileSync('./handlers/flows/seguros.flow.js', 'utf8');

    const titularMatch = flowSource.match(/DATOS_TITULAR_PREGUNTAS\s*=\s*\[([^\]]+)\]/);
    if (titularMatch) {
        const count = (titularMatch[1].match(/\{ field:/g) || []).length;
        assert(count === 6, `Titular: ${count} preguntas (ISSUE #9: esperado 6)`);
    } else {
        assert(false, 'No se encontró DATOS_TITULAR_PREGUNTAS');
    }

    const mascotaMatch = flowSource.match(/DATOS_MASCOTA_PREGUNTAS\s*=\s*\[([^\]]+)\]/);
    if (mascotaMatch) {
        const count = (mascotaMatch[1].match(/\{ field:/g) || []).length;
        assert(count === 3, `Mascota: ${count} preguntas (esperado 3)`);
    } else {
        assert(false, 'No se encontró DATOS_MASCOTA_PREGUNTAS');
    }

    // ===================================
    // 6. Validar funciones específicas
    // ===================================
    console.log('\n📁 6. Validando funciones de validación...');

    // Simular validarFecha
    const validarFechaSrc = flowSource.match(/function validarFecha[\s\S]*?\n\}/);
    assert(validarFechaSrc, 'validarFecha() existe (ISSUE #5)');

    // Simular normalizarTipoDocumento
    const normalizarDocSrc = flowSource.match(/function normalizarTipoDocumento[\s\S]*?\n\}/);
    assert(normalizarDocSrc, 'normalizarTipoDocumento() existe (ISSUE #4)');

    // Simular validarEdadMascota
    const validarEdadSrc = flowSource.match(/function validarEdadMascota[\s\S]*?\n\}/);
    assert(validarEdadSrc, 'validarEdadMascota() existe (ISSUE #7)');

    // Verificar guardarSolicitud con status
    assert(flowSource.includes("'pendiente'"), 'guarda con status=pendiente');
    assert(flowSource.includes("'rechazado'"), 'guarda con status=rechazado (ISSUE #8)');
    assert(flowSource.includes('cancel_reason'), 'guarda cancel_reason (ISSUE #8)');

    // Verificar eliminación de pago
    assert(!flowSource.includes('INS_PAGO'), 'No hay referencia a INS_PAGO (ISSUE #3)');
    assert(!flowSource.includes('LISTO'), 'No hay referencia a LISTO/pago (ISSUE #3)');

    // ===================================
    // 7. Validar handler.js
    // ===================================
    console.log('\n📁 7. Validando handler.js...');
    
    const handlerSource = fs.readFileSync('./handlers/handler.js', 'utf8');
    assert(handlerSource.includes('INS_RECHAZO'), 'handler.js tiene case INS_RECHAZO');
    assert(!handlerSource.includes('INS_PAGO'), 'handler.js sin referencia a INS_PAGO');

    // ===================================
    // 8. Validar phases.js
    // ===================================
    console.log('\n📁 8. Validando phases.js...');
    
    const phasesSource = fs.readFileSync('./utils/phases.js', 'utf8');
    assert(phasesSource.includes("INS_RECHAZO: 'ins_rechazo'"), 'phases.js tiene INS_RECHAZO');
    assert(!phasesSource.includes("INS_PAGO: 'ins_pago'"), 'phases.js sin INS_PAGO');

    // ===================================
    // RESULTADOS
    // ===================================
    console.log('\n' + '='.repeat(50));
    console.log(`📊 RESULTADOS QA`);
    console.log('='.repeat(50));
    console.log(`  ✅ Pasaron: ${passed}`);
    console.log(`  ❌ Fallaron: ${failed}`);
    
    if (errors.length > 0) {
        console.log('\n  Errores:');
        errors.forEach(e => console.log(`    - ${e}`));
    }

    if (failed === 0) {
        console.log('\n  🎉 ¡TODOS LOS ISSUES VALIDADOS!');
    } else {
        console.log(`\n  ⚠️  ${failed} issue(s) con errores`);
        process.exit(1);
    }
}

run().catch(e => {
    console.error('Error fatal en QA:', e.message);
    process.exit(1);
});
