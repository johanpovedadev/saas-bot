'use strict';
/** auditLog: registro de solo-agregar con cadena SHA-256; detecta ediciones, borrados y reordenamientos. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
process.env.AUDIT_LOG_PATH = path.join(TMP, 'audit.jsonl');
process.env.AUDIT_MIRROR_PATH = path.join(TMP, 'espejo', 'audit-copia.jsonl');
process.env.LOG_LEVEL = 'fatal';
const auditLog = require('./services/auditLog');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

check(auditLog.verify().ok && auditLog.verify().total === 0, 'un archivo vacío es válido');
for (let i = 1; i <= 5; i++) auditLog.record({ action: 'price_update', actor: '573001112222@c.us', role: 'owner', text: `cambia el precio ${i}`, details: { producto: 'Cono', precioNuevo: 1000 * i } });
const ev = auditLog.readAll();
check(ev.length === 5 && ev.every((e, i) => e.seq === i + 1), 'los 5 eventos quedan numerados en orden');
check(ev[0].tsLocal && ev[0].ts && ev[0].actor === '573001112222@c.us' && ev[0].text === 'cambia el precio 1', 'cada evento trae hora (Bogotá y ISO), quién y el texto exacto');
check(auditLog.verify().ok, 'la cadena es íntegra');
check(fs.readFileSync(process.env.AUDIT_MIRROR_PATH, 'utf8') === fs.readFileSync(process.env.AUDIT_LOG_PATH, 'utf8'), 'la copia espejo es idéntica');

const original = fs.readFileSync(process.env.AUDIT_LOG_PATH, 'utf8');
const L = original.split('\n').filter(Boolean);
const escribir = (lineas) => fs.writeFileSync(process.env.AUDIT_LOG_PATH, lineas.join('\n') + '\n');

const editada = JSON.parse(L[2]); editada.text = 'cambia el precio 999'; escribir([L[0], L[1], JSON.stringify(editada), L[3], L[4]]);
let v = auditLog.verify(); check(!v.ok && v.firstBad.line === 3, `editar el contenido de una línea se detecta en la línea 3 (real: ${v.firstBad && v.firstBad.line})`);

escribir([L[0], L[1], L[3], L[4]]); v = auditLog.verify(); check(!v.ok && v.firstBad.line === 3, `borrar una línea se detecta (línea ${v.firstBad && v.firstBad.line})`);
escribir([L[0], L[2], L[1], L[3], L[4]]); check(!auditLog.verify().ok, 'reordenar líneas se detecta');
escribir(L.slice(0, 4)); check(auditLog.verify().ok, 'cortar el final NO rompe la cadena (por eso hay copia espejo y se debe revisar el total)');
escribir(L); check(auditLog.verify().ok, 'al restaurar el original la cadena vuelve a ser íntegra');

// Un registro nuevo se encadena con el último
auditLog.record({ action: 'faq_added', actor: 'x', role: 'owner', text: 'guarda esto' });
check(auditLog.verify().ok && auditLog.readAll().length === 6, 'agregar después de restaurar sigue encadenado');

process.env.AUDIT_LOG_PATH = path.join(TMP, 'no', 'existe', 'x.jsonl');
check(auditLog.record({ action: 'x' }).ok === true, 'crea las carpetas si no existen');
console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
process.exit(failures ? 1 : 0);
