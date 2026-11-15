'use strict';
/**
 * Escucha de WhatsApp, 14 nov 2026: puede usar una copia aparte de whatsapp-web.js (bot-wasap/escucha_lib) sin
 * tocar la de Mundo Helados. Sin WhatsApp ni librería real: rutas y lecturas falsas. Uso: node test_escucha_libreria_aparte.js
 */
const assert = require('assert');
const path = require('path');
const { resolveWwebjs, wwebjsVersion } = require('./lion-readonly-wwebjs');

const base = path.join(path.sep, 'bot');
const libPkg = path.join(base, 'escucha_lib', 'node_modules', 'whatsapp-web.js', 'package.json');

try {
    assert.deepStrictEqual(resolveWwebjs({ env: {}, baseDir: base, exists: () => true }), { request: 'whatsapp-web.js', separate: false });
    console.log('OK: sin LION_READONLY_WWEBJS_DIR usa la librería de siempre');

    const r = resolveWwebjs({ env: { LION_READONLY_WWEBJS_DIR: 'escucha_lib' }, baseDir: base, exists: (p) => p === libPkg });
    assert.deepStrictEqual(r, { request: path.dirname(libPkg), separate: true });
    console.log('OK: con la variable y la copia instalada, usa la copia aparte');

    assert.deepStrictEqual(resolveWwebjs({ env: { LION_READONLY_WWEBJS_DIR: 'escucha_lib' }, baseDir: base, exists: () => false }), { request: 'whatsapp-web.js', separate: false });
    console.log('OK: si la variable apunta a una carpeta sin la librería, no revienta y usa la de siempre');

    assert.strictEqual(wwebjsVersion(path.dirname(libPkg), () => '{"version":"1.34.8"}'), '1.34.8');
    assert.strictEqual(wwebjsVersion(path.dirname(libPkg), () => { throw new Error('no existe'); }), '?');
    console.log('OK: muestra la versión en el log (y "?" si no la puede leer)');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
}
