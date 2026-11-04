'use strict';

/**
 * Presentador de Leo (#144, bloque 1), como heladeria.agent.presenter.js: la dueña de Mundo Helados lo resumió,
 * "si la persona tiene que leer y seguir instrucciones, no pega". Toda respuesta pasa por present() antes de
 * enviarse:
 *  - máximo 3 líneas; lo demás va detrás de un botón "➕ Ver más";
 *  - una sola pregunta por mensaje (las otras pasan a "Ver más");
 *  - nunca "escribí el número / respondé 1, 2 o 3": eso lo resuelven los botones;
 *  - sin repetir el saludo si ya saludó hoy.
 * Excepción (`full`): los informes de la noche y semanal, y las pantallas que la persona pidió para leer
 * (resumen, salud, medallas, préstamos...): son largas a propósito. Función pura.
 */

const MAX_LINES = 3;
const MORE_DATA = 'leo:ver-mas';
const MORE_BUTTON = Object.freeze({ text: '➕ Ver más', data: MORE_DATA });

// Instrucciones que los botones ya resuelven: se quitan (la línea entera si solo es eso).
const INSTRUCTIONS = [
    /_?\(?\s*escrib[ií] el n[uú]mero[^)\n]*\)?_?/gi,
    /_?\(?\s*respond[eé] (?:con )?(?:el n[uú]mero|\d(?:\s*,\s*\d)*\s*o\s*\d)[^)\n]*\)?_?/gi,
    /_?\(?\s*eleg[ií] (?:una opci[oó]n )?con el n[uú]mero[^)\n]*\)?_?/gi,
];
// Un saludo al principio del mensaje ("🦁 ¡Qué hubo, *Ana*!"): una vez por día.
const GREETING_LINE = /^\s*🦁?\s*¡?(?:qu[eé] hubo|hola|hey|qu[eé] m[aá]s|holi+)\b[^\n]*!?\s*$/i;

function isQuestion(line) {
    return /\?/.test(line);
}

function stripInstructions(text) {
    let out = String(text || '');
    for (const re of INSTRUCTIONS) out = out.replace(re, '');
    return out.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * @param {string} text - lo que iba a decir Leo
 * @param {{ full?: boolean, greetedToday?: boolean }} [opts]
 * @returns {{ text: string, more: string, greeted: boolean }} `more` es lo que va detrás de "Ver más" ('' si nada);
 *   `greeted` dice si el mensaje que sale saluda (para no repetirlo en el día).
 */
function present(text, { full = false, greetedToday = false } = {}) {
    const original = String(text || '');
    if (full) return { text: original, more: '', greeted: GREETING_LINE.test(original.split('\n')[0] || '') };
    let lines = stripInstructions(original).split('\n');
    let greeted = false;
    const firstContent = lines.findIndex((l) => l.trim());
    if (firstContent >= 0 && GREETING_LINE.test(lines[firstContent])) {
        if (greetedToday) lines.splice(firstContent, 1);
        else greeted = true;
    }
    const kept = [];
    const more = [];
    let contentLines = 0;
    let questions = 0;
    for (const line of lines) {
        if (!line.trim()) {
            if (more.length === 0 && contentLines > 0) kept.push(line);
            else if (more.length > 0) more.push(line);
            continue;
        }
        const extraQuestion = isQuestion(line) && questions >= 1;
        if (contentLines >= MAX_LINES || extraQuestion || more.length > 0) {
            more.push(line);
            continue;
        }
        kept.push(line);
        contentLines += 1;
        if (isQuestion(line)) questions += 1;
    }
    return {
        text: kept.join('\n').trim() || original.trim(),
        more: more.join('\n').trim(),
        greeted,
    };
}

module.exports = { present, stripInstructions, MORE_DATA, MORE_BUTTON, MAX_LINES };
