'use strict';

/**
 * Ejecutor de escenarios: cada escenario es una conversación completa de un cliente con el bot.
 * Uso: node tests_sim/run.js [--ai=sim|off] [--filter=texto] [--verbose] [--html=ruta]
 */

const RealDate = Date;

/** Reloj controlado: fija la hora del "ahora" para probar horarios (Bogotá = UTC-5). */
function setNow(iso) {
    const offset = new RealDate(iso).getTime() - RealDate.now();
    global.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
        static now() { return RealDate.now() + offset; }
    };
}
function restoreClock() { global.Date = RealDate; }

function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function matches(text, pattern) {
    if (pattern instanceof RegExp) return pattern.test(text);
    return norm(text).includes(norm(pattern));
}

class Checker {
    constructor(scenario) { this.scenario = scenario; this.failures = []; this.checks = 0; this.steps = 0; }
    fail(msg, detail) { this.failures.push({ msg, detail }); }
    ok(cond, msg, detail) { this.checks++; if (!cond) this.fail(msg, detail); return !!cond; }

    /**
     * El cliente escribe `text`; se verifica lo que el bot respondió.
     * exp: { has: [..], hasNot: [..], phase, errorCount, min (mínimo de mensajes), silent (no debe responder) }
     */
    async say(c, text, exp = {}) {
        this.steps++;
        const replies = await c.say(text);
        const all = replies.join('\n');
        const where = `turno ${this.steps} ("${text}")`;
        const detail = () => `respuesta: ${all.slice(0, 400).replace(/\n/g, ' / ') || '(silencio)'}`;
        if (exp.silent) this.ok(replies.length === 0, `${where}: el bot debía quedarse callado`, detail());
        else this.ok(replies.length >= (exp.min || 1), `${where}: el bot no respondió nada`, detail());
        for (const p of exp.has || []) this.ok(matches(all, p), `${where}: debía decir ${p}`, detail());
        for (const p of exp.hasNot || []) this.ok(!matches(all, p), `${where}: NO debía decir ${p}`, detail());
        if (exp.phase !== undefined) this.ok(c.session && c.session.phase === exp.phase, `${where}: fase esperada ${exp.phase}`, `fase real: ${c.session && c.session.phase}`);
        if (exp.errorCount !== undefined) this.ok((c.session && c.session.errorCount || 0) === exp.errorCount, `${where}: errorCount esperado ${exp.errorCount}`, `real: ${c.session && c.session.errorCount}`);
        return replies;
    }
}

async function runScenario(scenario, w, mode) {
    restoreClock();
    const t = new Checker(scenario);
    const c = w.customer(scenario.id);
    w.ordersOf = (cust) => w.backend.orders.filter(o => o.payload.cliente_jid === cust.jid);
    if (scenario.now) setNow(scenario.now);
    const t0 = Date.now();
    try {
        await scenario.run({ c, w, t, customer: w.customer, setNow, restoreClock });
    } catch (e) {
        t.fail('el escenario se rompió con una excepción', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
    } finally {
        restoreClock();
    }
    return { scenario, failures: t.failures, checks: t.checks, steps: t.steps, ms: Date.now() - t0, transcript: c.transcript, mode };
}

module.exports = { runScenario, setNow, restoreClock, matches, norm };
