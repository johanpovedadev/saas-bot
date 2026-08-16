'use strict';
/**
 * Prueba mutedStore.js aislado (sin admin.handler.js), y el caso de uso real
 * que justifica su existencia: un mute hecho desde OTRO proceso (simulando
 * el panel web) debe ser respetado por isChatMuted() del bot en vivo, sin
 * que ese proceso tenga el jid en su propio ctx.mutedChats en memoria.
 * Uso: node test_muted_store.js
 */
const assert = require('assert');
const path = require('path');
process.env.BUSINESS_KEY = 'heladeria';
process.env.MUTED_STORE_PATH = path.join(__dirname, 'data', `__test_mutedstore_${Date.now()}.json`);

const mutedStore = require('./services/mutedStore');
const adminHandler = require('./handlers/modules/admin.handler');

(async () => {
    try {
        const businessKey = 'heladeria';
        const jid = '573007778899@c.us';

        assert.strictEqual(mutedStore.isMuted(businessKey, jid), false);
        console.log('OK: arranca sin nada silenciado');

        mutedStore.muteChat(businessKey, jid);
        assert.strictEqual(mutedStore.isMuted(businessKey, jid), true);
        assert.deepStrictEqual(mutedStore.listMuted(businessKey), [jid]);
        console.log('OK: muteChat silencia y listMuted lo refleja');

        mutedStore.muteChat(businessKey, jid); // repetir no debe duplicar
        assert.strictEqual(mutedStore.listMuted(businessKey).length, 1);
        console.log('OK: muteChat es idempotente');

        // Caso de uso real: un proceso de bot con ctx.mutedChats VACIO (nunca
        // supo de este mute en memoria) debe igual respetarlo via isChatMuted,
        // porque otro proceso (ej. el panel) lo silencio via mutedStore.
        const ctxDeOtroProceso = { mutedChats: new Set() };
        assert.strictEqual(adminHandler.isChatMuted(jid, ctxDeOtroProceso), true,
            'isChatMuted debe consultar mutedStore cuando no esta en memoria local');
        console.log('OK: isChatMuted respeta un mute hecho por OTRO proceso (sin IPC, solo el archivo compartido)');

        const removed = mutedStore.unmuteChat(businessKey, jid);
        assert.strictEqual(removed, true);
        assert.strictEqual(mutedStore.isMuted(businessKey, jid), false);
        assert.strictEqual(adminHandler.isChatMuted(jid, ctxDeOtroProceso), false);
        console.log('OK: unmuteChat revierte y vuelve a ser visible para isChatMuted');

        const removedAgain = mutedStore.unmuteChat(businessKey, jid);
        assert.strictEqual(removedAgain, false, 'desilenciar algo que ya no esta silenciado debe devolver false');
        console.log('OK: unmuteChat sobre un chat ya desilenciado devuelve false');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { require('fs').unlinkSync(process.env.MUTED_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
