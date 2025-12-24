/**
 * Test Suite: Reconocimiento de Saludos Colombianos
 * 
 * Valida que el bot reconozca correctamente:
 * 1. Saludos informales (hola, hl, oli, etc.)
 * 2. Saludos coloquiales (q hubo, q mas, q tal, etc.)
 * 3. Saludos regionales (paisa, costeño, caleño, etc.)
 * 4. Saludos formales (buenos días, buenas tardes, etc.)
 */

const assert = require('assert');
const { 
    isGreeting, 
    getGreetingType, 
    getWelcomeMessage,
    isOnlyGreeting,
    handleGreeting,
    SALUDOS
} = require('../utils/greetings');

// Colores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function runTests() {
    log('\n╔══════════════════════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                   TEST SUITE: SALUDOS COLOMBIANOS                            ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════════════════════╝\n', 'cyan');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    // ========================================================================
    // TEST 1: Saludos Informales
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 1: Saludos Informales                                                  │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const informal = [
        'hola', 'ola', 'hol', 'holaa', 'holaaa',
        'hl', 'hla', 'oli', 'olis',
        'hey', 'hei', 'hi'
    ];
    
    try {
        totalTests++;
        for (const saludo of informal) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        // Verificar que detecta el tipo correcto
        const tipo = getGreetingType('hola');
        assert.strictEqual(tipo, 'informales', 'Tipo debe ser "informales"');
        log('   ✅ Tipo de saludo correcto: informales\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 2: Saludos Coloquiales
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 2: Saludos Coloquiales (q hubo, q mas, q tal)                          │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const coloquial = [
        'q hubo', 'qubo', 'kubo', 'que hubo',
        'q mas', 'que mas', 'q más', 'qué más',
        'q mas k', 'que mas ke',
        'q tal', 'que tal', 'qué tal'
    ];
    
    try {
        totalTests++;
        for (const saludo of coloquial) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        const tipo = getGreetingType('q mas');
        assert.strictEqual(tipo, 'coloquiales', 'Tipo debe ser "coloquiales"');
        log('   ✅ Tipo de saludo correcto: coloquiales\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 3: Saludos Buenas (bnas, bns)
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 3: Variantes de "Buenas" (bnas, bns)                                   │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const buenas = [
        'buenas', 'bnas', 'bns', 'buena',
        'buenos dias', 'buen dia', 'buenos días', 'buen día',
        'buenas tardes', 'buena tarde',
        'buenas noches', 'buena noche'
    ];
    
    try {
        totalTests++;
        for (const saludo of buenas) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        const tipo = getGreetingType('bnas');
        assert.strictEqual(tipo, 'buenas', 'Tipo debe ser "buenas"');
        log('   ✅ Tipo de saludo correcto: buenas\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 4: Saludos Regionales - Paisa
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 4: Saludos Paisas (Antioquia/Eje Cafetero)                             │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const paisa = [
        'que mas pues', 'q mas pues', 'qué más pues',
        'bien o que', 'bien o qué', 'bien o no',
        'parce', 'parcero', 'parcerito'
    ];
    
    try {
        totalTests++;
        for (const saludo of paisa) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        const tipo = getGreetingType('que mas pues');
        assert.strictEqual(tipo, 'paisa', 'Tipo debe ser "paisa"');
        
        const mensaje = getWelcomeMessage('paisa');
        assert.ok(mensaje.includes('Qué más, pues'), 'Mensaje debe tener saludo paisa');
        log('   ✅ Tipo correcto: paisa', 'green');
        log('   ✅ Mensaje personalizado: "¡Qué más, pues!"\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 5: Saludos Regionales - Costeño
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 5: Saludos Costeños (Costa Caribe)                                     │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const costeno = [
        'aja y que', 'ajá y qué', 'aja',
        'todo bien', 'todo bn',
        'habla', 'habla pues',
        'que cuentas', 'qué cuentas'
    ];
    
    try {
        totalTests++;
        for (const saludo of costeno) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        const tipo = getGreetingType('aja');
        assert.strictEqual(tipo, 'costeno', 'Tipo debe ser "costeno"');
        
        const mensaje = getWelcomeMessage('costeno');
        assert.ok(mensaje.includes('Ajá'), 'Mensaje debe tener saludo costeño');
        log('   ✅ Tipo correcto: costeno', 'green');
        log('   ✅ Mensaje personalizado: "¡Ajá! ¿Todo bien?"\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 6: Saludos Regionales - Caleño
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 6: Saludos Caleños (Valle del Cauca)                                   │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    const caleno = ['mira que mas', 'mirá qué más', 'mira', 'ois', 'oís', 'ois que tal'];
    
    try {
        totalTests++;
        for (const saludo of caleno) {
            assert.strictEqual(isGreeting(saludo), true, `"${saludo}" debe ser detectado como saludo`);
            log(`   ✅ "${saludo}" detectado correctamente`, 'green');
        }
        
        const tipo = getGreetingType('ois');
        assert.strictEqual(tipo, 'caleno', 'Tipo debe ser "caleno"');
        log('   ✅ Tipo correcto: caleno\n', 'green');
        
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 7: Detección de SOLO saludo vs saludo + pedido
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 7: Diferencia entre SOLO saludo vs saludo + pedido                     │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    try {
        totalTests++;
        
        // Solo saludos - deben retornar menú completo
        const soloSaludos = ['hola', 'q mas', 'buenas', 'aja', 'que mas pues'];
        for (const s of soloSaludos) {
            const result = handleGreeting(s);
            assert.strictEqual(result.isGreeting, true, `"${s}" debe ser saludo`);
            assert.ok(result.welcomeMessage, `"${s}" debe tener mensaje de bienvenida`);
            log(`   ✅ "${s}" → Menú completo`, 'green');
        }
        
        // Saludo + pedido - debe detectar saludo pero NO enviar menú
        const saludoConPedido = [
            'hola quiero una copa',
            'q mas necesito helado',
            'buenas, dame 2 litros'
        ];
        for (const s of saludoConPedido) {
            const result = handleGreeting(s);
            assert.strictEqual(result.isGreeting, true, `"${s}" debe detectar saludo`);
            assert.strictEqual(result.welcomeMessage, null, `"${s}" NO debe enviar menú (tiene pedido)`);
            log(`   ✅ "${s}" → Saludo detectado, sin menú (tiene pedido)`, 'green');
        }
        
        log('\n', 'green');
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // TEST 8: Mensajes que NO son saludos
    // ========================================================================
    log('┌──────────────────────────────────────────────────────────────────────────────┐', 'blue');
    log('│ TEST 8: Mensajes que NO deben ser detectados como saludos                   │', 'blue');
    log('└──────────────────────────────────────────────────────────────────────────────┘', 'blue');
    
    try {
        totalTests++;
        const noSaludos = [
            'copa',
            'quiero helado',
            '2',
            's1 s2 s3 s4',
            'pagar',
            'cancelar',
            'sin'
        ];
        
        for (const texto of noSaludos) {
            assert.strictEqual(isGreeting(texto), false, `"${texto}" NO debe ser detectado como saludo`);
            log(`   ✅ "${texto}" → NO es saludo`, 'green');
        }
        
        log('\n', 'green');
        passedTests++;
    } catch (error) {
        failedTests++;
        log(`   ❌ ERROR: ${error.message}\n`, 'red');
    }

    // ========================================================================
    // RESUMEN
    // ========================================================================
    log('\n╔══════════════════════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                           RESUMEN DE TESTS                                   ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════════════════════╝\n', 'cyan');
    
    log(`   Total de tests:     ${totalTests}`, 'yellow');
    log(`   Tests exitosos:     ${passedTests}`, 'green');
    log(`   Tests fallidos:     ${failedTests}`, failedTests > 0 ? 'red' : 'green');
    
    const successRate = ((passedTests / totalTests) * 100).toFixed(1);
    log(`\n   Tasa de éxito:      ${successRate}%`, successRate === '100.0' ? 'green' : 'yellow');
    
    if (passedTests === totalTests) {
        log('\n   ✅ ¡TODOS LOS TESTS PASARON CORRECTAMENTE!', 'green');
        log('   ✅ Sistema de saludos listo para producción 🚀\n', 'green');
    } else {
        log('\n   ⚠️  Algunos tests fallaron. Revisar errores arriba.\n', 'yellow');
    }
    
    // Resumen de saludos soportados
    log('╔══════════════════════════════════════════════════════════════════════════════╗', 'magenta');
    log('║                        SALUDOS SOPORTADOS                                    ║', 'magenta');
    log('╚══════════════════════════════════════════════════════════════════════════════╝\n', 'magenta');
    
    const totalSaludos = Object.values(SALUDOS).reduce((sum, arr) => sum + arr.length, 0);
    log(`   Total de variantes: ${totalSaludos} saludos\n`, 'cyan');
    
    const categories = [
        ['Informales', SALUDOS.informales.length, SALUDOS.informales.slice(0, 5).join(', ')],
        ['Coloquiales', SALUDOS.coloquiales.length, SALUDOS.coloquiales.slice(0, 5).join(', ')],
        ['Buenas', SALUDOS.buenas.length, SALUDOS.buenas.slice(0, 5).join(', ')],
        ['Paisas', SALUDOS.paisa.length, SALUDOS.paisa.slice(0, 3).join(', ')],
        ['Costeños', SALUDOS.costeno.length, SALUDOS.costeno.slice(0, 3).join(', ')],
        ['Caleños', SALUDOS.caleno.length, SALUDOS.caleno.slice(0, 3).join(', ')],
        ['Bogotanos', SALUDOS.bogotano.length, SALUDOS.bogotano.slice(0, 3).join(', ')],
        ['Santandereanos', SALUDOS.santandereano.length, SALUDOS.santandereano.slice(0, 2).join(', ')]
    ];
    
    categories.forEach(([cat, count, examples]) => {
        log(`   ${cat}: ${count} variantes`, 'yellow');
        log(`      Ejemplos: ${examples}...`, 'cyan');
    });
    
    log('');
}

// Ejecutar tests
runTests().catch(error => {
    log(`\n❌ ERROR FATAL: ${error.message}\n`, 'red');
    console.error(error);
    process.exit(1);
});
