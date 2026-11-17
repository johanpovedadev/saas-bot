const test=require('node:test');const assert=require('node:assert/strict');
const c=require('./ecosystem.oracle.config.js');
test('se mudan solo las apps elegidas',()=>{assert.equal(c.apps.length,9);assert.ok(!c.apps.some(a=>/mascotas|pescaderia|dev|tunel|publico|importar/.test(a.name)))});
test('rutas y python de Linux',()=>{for(const a of c.apps){assert.ok(!a.cwd.includes('\\'));assert.ok(a.env.TZ==='America/Bogota')}
 const dj=c.apps.find(a=>a.name==='django-heladeria');assert.match(dj.interpreter,/\.venv\/bin\/python$/);
 assert.ok(c.apps.filter(a=>a.name.startsWith('bot-')).every(a=>a.env.CHROME_PATH));
 assert.ok(c.apps.filter(a=>a.name.startsWith('agentvents')).every(a=>a.cwd.endsWith('agentvents')&&!a.env.CHROME_PATH));
 assert.equal(c.apps.find(a=>a.name==='agentvents-seguimientos').cron_restart,'45 7 * * 1-6')});
test('ruta desconocida avisa',()=>assert.throws(()=>c.linuxCwd('D:\\otra'),/No sé dónde/));
