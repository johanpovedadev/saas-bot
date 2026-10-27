'use strict';
/**
 * Revisión diaria del bot (services/dailyReview.js) a mano.
 *
 * Uso (desde bot-wasap/):
 *   node scripts/daily-review.js heladeria          -> imprime la revisión de hoy
 *   node scripts/daily-review.js heladeria --send   -> además la manda a Telegram (Jarvis León)
 */
const businessKey = process.argv[2];
if (!businessKey || businessKey.startsWith('--')) {
    console.error('Uso: node scripts/daily-review.js <negocio> [--send]');
    process.exit(2);
}
process.env.BUSINESS_KEY = businessKey;
const dailyReview = require('../services/dailyReview');

(async () => {
    const text = dailyReview.buildTodayReview();
    console.log(text);
    if (process.argv.includes('--send')) {
        const ok = await dailyReview.sendTelegram(text);
        console.log(ok ? '\n✅ Enviada a Telegram' : '\n❌ No se pudo enviar (revisa HERMES_BOT_TOKEN y ADMIN_TELEGRAM_ID)');
        process.exit(ok ? 0 : 1);
    }
})();
