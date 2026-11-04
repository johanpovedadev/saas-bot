'use strict';

/**
 * Novedades de Leo en el informe de la noche (#129): "🆕 Leo aprendió cosas nuevas".
 *
 * Johan: "cuando hagamos mejoras, que en la noche envíe un mensaje diciendo lo que se ha mejorado para que lo
 * prueben". Cada release con un cambio que el usuario ve agrega una entrada en NEWS (ver docs/AGENTE_ARRANQUE.md):
 * texto en voseo, corto, sin montos y con un "probalo" concreto. Cambios internos (pruebas, docs) no van.
 *
 * Cada usuario ve cada versión una sola vez (fin.lastNewsSeen). Quien se registró después de la fecha de una
 * novedad no la recibe: para esa persona todo es nuevo. Funciones puras; finance.flow.js solo las llama.
 *
 * Orden: la versión más nueva arriba; dentro de cada versión, lo más importante primero.
 */
const NEWS = [
    {
        id: '1.9.0',
        date: '2026-11-03',
        items: [
            { text: 'Leo ahora entiende mejor lo que le escribís, fotos y audios', probar: 'mandame un audio con tus gastos de hoy' },
            { text: 'Tus informes ahora vienen con *gráficas*', probar: 'escribí *gráfica*' },
            { text: 'Si me decís con qué pagaste y cuándo, ya no te lo pregunto', probar: 'escribí _almuerzo 15 mil con la Rappi ayer_' },
            { text: 'Tus gastos de siempre ahora están *a un toque*', probar: 'escribí *menú* y tocá tu gasto de siempre' },
            { text: 'Podés *ocultar tu plata* para que nadie la vea', probar: 'escribí *ocultar saldo*' },
        ],
    },
    {
        id: '1.8.0',
        date: '2026-11-03',
        items: [
            { text: 'Ahora tocás *botones* en vez de escribir comandos, y en cada pantalla hay ⬅️ Volver', probar: 'escribí *menú*' },
            { text: 'Los gastos claros se *guardan de una*; si algo salió mal, lo arreglás con ✏️ Corregir o 🗑️ Borrar', probar: 'escribí _almuerzo 15 mil_' },
            { text: 'Entiendo *varias cosas en un mensaje* y cantidades', probar: 'escribí _almuerzo 14 mil, arepas 4000, pan 2000_' },
            { text: '*Mi meta* te muestra cuánto llevás, cuándo llegás y tu próximo escalón', probar: 'escribí *metas*' },
        ],
    },
];

const MAX_VERSIONS = 2;
const MAX_ITEMS = 3;

/** -1, 0 o 1 comparando versiones "x.y.z" (una vacía es la más vieja). */
function compareVersions(a, b) {
    const pa = String(a || '').split('.').map(Number);
    const pb = String(b || '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return Math.sign(diff);
    }
    return 0;
}

/**
 * Las novedades que este usuario no ha visto: versiones posteriores a fin.lastNewsSeen y anteriores a su registro
 * (máx. las 2 últimas versiones y 3 ítems en total, las más nuevas). `registeredOn` es "YYYY-MM-DD..." o vacío.
 */
function pendingNews(fin, { registeredOn = '', news = NEWS } = {}) {
    const registered = String(registeredOn || '').slice(0, 10);
    const versions = news
        .filter((v) => compareVersions(v.id, fin.lastNewsSeen) > 0)
        .filter((v) => !registered || registered < v.date)
        .sort((a, b) => compareVersions(b.id, a.id))
        .slice(0, MAX_VERSIONS);
    return versions.flatMap((v) => v.items).slice(0, MAX_ITEMS);
}

function itemLines(items) {
    return items.map((item) => `• ${item.text} → probalo: ${item.probar}`).join('\n');
}

/** Bloque del informe de la noche ('' si no hay nada nuevo). */
function formatNews(items) {
    return items.length > 0 ? `🆕 *Leo aprendió cosas nuevas:*\n${itemLines(items)}` : '';
}

/** Para el reenganche de quien no volvió (#123): las novedades son una buena excusa para volver. */
function formatNewsWhileAway(items) {
    return items.length > 0 ? `🆕 Mientras no estabas, Leo aprendió:\n${itemLines(items)}` : '';
}

/** Marca como vistas todas las novedades hasta la versión más nueva. */
function markNewsSeen(fin, news = NEWS) {
    const latest = news.map((v) => v.id).sort(compareVersions).pop();
    if (latest && compareVersions(latest, fin.lastNewsSeen) > 0) fin.lastNewsSeen = latest;
    return fin;
}

module.exports = { NEWS, pendingNews, formatNews, formatNewsWhileAway, markNewsSeen, compareVersions };
