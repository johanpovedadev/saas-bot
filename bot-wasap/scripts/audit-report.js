'use strict';

/**
 * Informe del registro de auditoría: quién cambió qué y a qué hora, y si el archivo fue alterado.
 *
 *   node scripts/audit-report.js <negocio> [--desde=2026-10-06] [--hasta=2026-10-07] [--accion=price_update] [--quien=57313...]
 *   node scripts/audit-report.js <negocio> --verificar        (solo comprueba que nadie tocó el archivo)
 *
 * Ejemplo: node scripts/audit-report.js heladeria --desde=2026-10-06
 */
const path = require('path');
const auditLog = require('../services/auditLog');

const args = process.argv.slice(2);
const negocio = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
if (!negocio) { console.error('Uso: node scripts/audit-report.js <negocio> [--desde=AAAA-MM-DD] [--hasta=AAAA-MM-DD] [--accion=x] [--quien=numero] [--verificar]'); process.exit(1); }

const file = path.join(__dirname, '..', 'logs', `audit-${negocio}.jsonl`);
const v = auditLog.verify(file);
console.log(v.ok
    ? `✅ Cadena íntegra: ${v.total} eventos, nadie alteró el archivo.`
    : `❌ ARCHIVO ALTERADO: ${v.firstBad.reason} (línea ${v.firstBad.line}${v.firstBad.seq ? `, evento #${v.firstBad.seq}` : ''}). Lo anterior a esa línea sí es confiable.`);
if (opt.verificar) process.exit(v.ok ? 0 : 2);

const dia = (s, fin) => (s ? new Date(`${s}T${fin ? '23:59:59' : '00:00:00'}-05:00`).getTime() : null);
const desde = dia(opt.desde, false); const hasta = dia(opt.hasta, true);
const eventos = auditLog.readAll(file).filter(e => !e.corrupt)
    .filter(e => (!desde || new Date(e.ts).getTime() >= desde) && (!hasta || new Date(e.ts).getTime() <= hasta))
    .filter(e => (!opt.accion || e.action === opt.accion) && (!opt.quien || String(e.actor || '').includes(opt.quien)));

console.log(`\n${eventos.length} evento(s) de "${negocio}"\n`);
for (const e of eventos) {
    console.log(`#${e.seq}  ${e.tsLocal} (hora Bogotá)  ·  ${e.action}  ·  ${e.role || '-'} ${e.actor || ''}`);
    if (e.text) console.log(`   mensaje: "${e.text}"`);
    if (e.details) console.log(`   detalle: ${JSON.stringify(e.details)}`);
}
