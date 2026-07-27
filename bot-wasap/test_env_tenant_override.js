'use strict';
/**
 * Test manual: valida que env.loader.js soporte un .env.<BUSINESS_KEY> opcional
 * que sobreescribe al .env compartido, SIN romper a los tenants que no tienen
 * archivo propio (comportamiento identico al de antes).
 *
 * Uso: node test_env_tenant_override.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const probeScript = path.join(__dirname, '_env_probe.js');
const tenantEnvPath = path.join(projectRoot, '.env.__test_tenant');

fs.writeFileSync(
    probeScript,
    "const envConfig = require('./config/env.loader');\n" +
    "process.stdout.write(JSON.stringify({ probe: process.env.TEST_TENANT_PROBE || null }));\n"
);

function runWithBusinessKey(businessKey) {
    const out = execFileSync('node', [probeScript], {
        cwd: __dirname,
        env: { ...process.env, BUSINESS_KEY: businessKey },
        encoding: 'utf-8'
    });
    return JSON.parse(out.trim().split('\n').pop());
}

try {
    // 1. Sin archivo .env.__test_tenant -> no debe existir la variable (comportamiento actual)
    const before = runWithBusinessKey('__test_tenant');
    assert.strictEqual(before.probe, null, 'Sin .env.__test_tenant, TEST_TENANT_PROBE no debe existir');
    console.log('OK: sin .env.<tenant> el bot arranca igual que hoy (usa solo el .env compartido)');

    // 2. Con .env.__test_tenant -> debe tomar el valor del archivo propio del tenant
    fs.writeFileSync(tenantEnvPath, 'TEST_TENANT_PROBE=valor_del_tenant\n');
    const after = runWithBusinessKey('__test_tenant');
    assert.strictEqual(after.probe, 'valor_del_tenant', 'Con .env.__test_tenant, debe tomar el valor propio del tenant');
    console.log('OK: con .env.<tenant> presente, sus variables tienen prioridad sobre el .env compartido');

    // 3. Un tenant real existente (mascotas) sigue arrancando sin .env propio, sin crashear
    const mascotas = runWithBusinessKey('mascotas');
    assert.strictEqual(mascotas.probe, null, 'mascotas no debe verse afectado (no tiene .env.mascotas)');
    console.log('OK: tenants existentes (ej. mascotas) no se ven afectados');

    console.log('\nTodos los tests pasaron.');
    process.exitCode = 0;
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    try { fs.unlinkSync(tenantEnvPath); } catch (_) {}
    try { fs.unlinkSync(probeScript); } catch (_) {}
}
