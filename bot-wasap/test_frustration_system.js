/**
 * Test del Sistema de Detección de Frustración
 * 
 * Prueba los 3 tipos de detección:
 * 1. Keywords de frustración
 * 2. Errores consecutivos
 * 3. Mensajes repetidos
 */

const frustrationService = require('./services/frustrationService');
const PHASE = require('./utils/phases');

console.log('🧪 INICIANDO TEST DEL SISTEMA DE FRUSTRACIÓN\n');

// ========================================
// TEST 1: Detección por Keywords
// ========================================
console.log('📋 TEST 1: Detección por Keywords de Frustración');
console.log('─'.repeat(50));

const testKeywords = [
    'no entiendo nada',
    '???',
    'ayuda por favor',
    'quiero hablar con una persona',
    'esto es muy complicado',
    'no funciona',
    'operador'
];

let passed = 0;
let failed = 0;

testKeywords.forEach(keyword => {
    const session = {
        jid: 'test@s.whatsapp.net',
        phase: PHASE.SELECCION_OPCION,
        errorCount: 0,
        messageHistory: []
    };
    
    const result = frustrationService.detectFrustration(session, keyword);
    
    if (result) {
        console.log(`  ✅ "${keyword}" -> DETECTADO`);
        passed++;
    } else {
        console.log(`  ❌ "${keyword}" -> NO DETECTADO (ERROR)`);
        failed++;
    }
});

console.log(`\n📊 Resultado: ${passed}/${testKeywords.length} keywords detectados\n`);

// ========================================
// TEST 2: Detección por Errores Consecutivos
// ========================================
console.log('📋 TEST 2: Detección por Errores Consecutivos');
console.log('─'.repeat(50));

const session2 = {
    jid: 'test2@s.whatsapp.net',
    phase: PHASE.SELECTING_FLAVOR,
    errorCount: 0,
    messageHistory: []
};

console.log('  Simulando errores consecutivos...');

// Error 1
frustrationService.incrementErrorCount(session2);
console.log(`  Error 1: errorCount=${session2.errorCount}, frustrado=${frustrationService.detectFrustration(session2, 'mensaje normal')}`);

// Error 2
frustrationService.incrementErrorCount(session2);
console.log(`  Error 2: errorCount=${session2.errorCount}, frustrado=${frustrationService.detectFrustration(session2, 'mensaje normal')}`);

// Error 3 (debería detectar frustración)
frustrationService.incrementErrorCount(session2);
const frustrated = frustrationService.detectFrustration(session2, 'mensaje normal');
console.log(`  Error 3: errorCount=${session2.errorCount}, frustrado=${frustrated}`);

if (frustrated) {
    console.log('  ✅ Frustración detectada al tercer error');
    passed++;
} else {
    console.log('  ❌ NO se detectó frustración (ERROR)');
    failed++;
}

// Test de reset
frustrationService.resetErrorCount(session2);
console.log(`  Reset: errorCount=${session2.errorCount}`);

if (session2.errorCount === 0) {
    console.log('  ✅ Reset de errores funciona correctamente\n');
    passed++;
} else {
    console.log('  ❌ Reset de errores NO funciona\n');
    failed++;
}

// ========================================
// TEST 3: Detección por Mensajes Repetidos
// ========================================
console.log('📋 TEST 3: Detección por Mensajes Repetidos');
console.log('─'.repeat(50));

const session3 = {
    jid: 'test3@s.whatsapp.net',
    phase: PHASE.SELECTING_TOPPING,
    errorCount: 0,
    messageHistory: []
};

console.log('  Enviando mismo mensaje 3 veces...');

// Mensaje 1
let result1 = frustrationService.detectFrustration(session3, 'hola');
console.log(`  Mensaje 1: messageHistory=${session3.messageHistory.length}, frustrado=${result1}`);

// Mensaje 2 (repetido)
let result2 = frustrationService.detectFrustration(session3, 'hola');
console.log(`  Mensaje 2: messageHistory=${session3.messageHistory.length}, frustrado=${result2}`);

// Mensaje 3 (repetido - debería detectar)
let result3 = frustrationService.detectFrustration(session3, 'hola');
console.log(`  Mensaje 3: messageHistory=${session3.messageHistory.length}, frustrado=${result3}`);

if (result3) {
    console.log('  ✅ Frustración detectada al tercer mensaje repetido');
    passed++;
} else {
    console.log('  ❌ NO se detectó frustración (ERROR)');
    failed++;
}

console.log('');

// ========================================
// TEST 4: Estado WAITING_HUMAN
// ========================================
console.log('📋 TEST 4: Estado WAITING_HUMAN');
console.log('─'.repeat(50));

const session4 = {
    jid: 'test4@s.whatsapp.net',
    phase: PHASE.WAITING_HUMAN,
    errorCount: 0,
    messageHistory: []
};

const isWaiting = frustrationService.isWaitingForHuman(session4);
console.log(`  Usuario en estado WAITING_HUMAN: ${isWaiting}`);

if (isWaiting) {
    console.log('  ✅ isWaitingForHuman() funciona correctamente');
    passed++;
} else {
    console.log('  ❌ isWaitingForHuman() NO funciona');
    failed++;
}

// Reactivar bot
frustrationService.reactivateBot(session4);
console.log(`  Fase después de reactivar: ${session4.phase}`);

if (session4.phase === PHASE.AWAITING_GREETING) {
    console.log('  ✅ reactivateBot() funciona correctamente\n');
    passed++;
} else {
    console.log('  ❌ reactivateBot() NO funciona correctamente\n');
    failed++;
}

// ========================================
// TEST 5: Mensajes que NO deben detectar frustración
// ========================================
console.log('📋 TEST 5: Mensajes Normales (NO deben detectar frustración)');
console.log('─'.repeat(50));

const normalMessages = [
    'Hola',
    'Quiero un helado de fresa',
    '1',
    'Si, confirmo',
    'Cuánto cuesta?'
];

const session5 = {
    jid: 'test5@s.whatsapp.net',
    phase: PHASE.SELECTING_FLAVOR,
    errorCount: 0,
    messageHistory: []
};

normalMessages.forEach(msg => {
    const detected = frustrationService.detectFrustration(session5, msg);
    if (!detected) {
        console.log(`  ✅ "${msg}" -> NO detectado (correcto)`);
        passed++;
    } else {
        console.log(`  ❌ "${msg}" -> DETECTADO (falso positivo)`);
        failed++;
    }
});

console.log('');

// ========================================
// RESUMEN FINAL
// ========================================
console.log('═'.repeat(50));
console.log('📊 RESUMEN DE TESTS');
console.log('═'.repeat(50));
console.log(`✅ Tests pasados: ${passed}`);
console.log(`❌ Tests fallidos: ${failed}`);
console.log(`📈 Tasa de éxito: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
    console.log('\n🎉 TODOS LOS TESTS PASARON - Sistema listo para commit\n');
    process.exit(0);
} else {
    console.log('\n⚠️  ALGUNOS TESTS FALLARON - Revisar antes de commit\n');
    process.exit(1);
}
