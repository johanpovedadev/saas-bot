'use strict';
/**
 * #186: el informe del estudio de la IA de Meta cuenta bien y nunca deja
 * teléfonos completos ni números largos. Sin IA ni WhatsApp.
 * Uso: node test_estudio_ia_meta.js
 */
const assert = require('assert');
const { buildReport, maskPhone, maskText } = require('./scripts/estudio_ia_meta');

const A = '573001112233@c.us';
const B = '573004445566@c.us';
const msg = (phone, fromMe, autor, text, ts, marcas = []) => ({ phone, fromMe, autor, text, timestamp: `2026-11-08T${ts}Z`, marcas });

try {
    assert.strictEqual(maskPhone(A), '•••33');
    assert.strictEqual(maskText('mi número es 300 111 2233, llámame'), 'mi número es •••••, llámame');
    console.log('OK: enmascara teléfonos y números largos');

    const messages = [
        msg(A, false, 'cliente', 'Hola', '10:00:00'),
        msg(A, false, 'cliente', '¿Cuánto vale el bot?', '10:00:05'),
        msg(A, true, 'ia_meta', 'Hola 👋 depende del plan', '10:00:15', ['bizBotType']),
        msg(A, false, 'cliente', 'Quiero hablar con alguien, mi cel 3001112233', '10:01:00'),
        msg(A, true, 'propio_desconocido', 'Hola, soy Johan', '10:11:00'),
        msg(B, false, 'cliente', 'cuanto vale el bot', '11:00:00'),
        msg(B, true, 'ia_meta', 'Te cuento los planes', '11:00:20'),
        msg(B, false, 'cliente', '📷 Imagen', '11:05:00'),
    ];
    const md = buildReport(messages, { from: '2026-11-01', to: '2026-11-08' });

    assert.ok(md.includes('Conversaciones: **2**'));
    assert.ok(md.includes('Respuestas de la IA de Meta: **2**'));
    assert.ok(md.includes('luego entraste tú: **1**'), 'cuenta el paso de la IA a Johan');
    assert.ok(md.includes('sin respuesta todavía: **1**'));
    assert.ok(md.includes('| IA de Meta | 2 | 15 s |'), 'mediana de 10 s y 20 s');
    assert.ok(md.includes('| Tu número (sin marca de IA) | 1 | 10 min |'));
    assert.ok(/\(2\) ¿Cuánto vale el bot\?/.test(md), 'agrupa la misma pregunta con y sin tildes');
    console.log('OK: cuenta conversaciones, respuestas, tiempos, paso a humano y preguntas frecuentes');

    for (const leak of ['3001112233', '573001112233', '573004445566', '4445566']) {
        assert.ok(!md.includes(leak), `no deja el número ${leak}`);
    }
    console.log('OK: el informe no deja teléfonos completos');

    const sinMarca = buildReport([
        msg(A, false, 'cliente', 'precio?', '10:00:00'),
        msg(A, true, 'propio_desconocido', 'hola', '10:00:09', ['agentId', 'deviceType=web']),
    ], { from: '2026-11-01', to: '2026-11-08' });
    assert.ok(sinMarca.includes('WhatsApp no marcó cuáles respuestas fueron de la IA de Meta'));
    assert.ok(sinMarca.includes('`agentId` × 1'));
    console.log('OK: si nada viene marcado, lo dice y muestra las marcas vistas');

    const vacio = buildReport([], { from: '2026-11-01', to: '2026-11-08' });
    assert.ok(vacio.includes('Aún no hay preguntas'));
    console.log('OK: sin datos no falla');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
}
