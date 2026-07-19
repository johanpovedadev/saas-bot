'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');

function buildFinanceContext(userSession) {
    const fin = userSession.finance || {};
    return {
        name: fin.name || '',
        balance: fin.balance || 0,
        todaySpending: fin.todaySpending || 0,
        totalTransactions: (fin.transactions || []).length,
        trialDaysLeft: fin.trialStart ? Math.max(0, 30 - Math.floor((Date.now() - fin.trialStart) / 86400000)) : 30,
        isPremium: !!fin.isPremium,
        recentTransactions: (fin.transactions || []).slice(-5).map(t => ({
            type: t.type,
            amount: t.amount,
            category: t.category,
            description: t.description,
            date: t.date
        }))
    };
}

function buildSystemPrompt(ctx) {
    const c = buildFinanceContext(ctx);
    return `Eres Leo 🦁, un asistente financiero personal empático, cercano y motivador.

Contexto del usuario:
- Nombre: ${c.name || 'aún no registrado'}
- Saldo actual: $${c.balance.toLocaleString('es-CO')}
- Gasto hoy: $${c.todaySpending.toLocaleString('es-CO')}
- Total transacciones: ${c.totalTransactions}
- Días de prueba gratis: ${c.trialDaysLeft}
- Premium: ${c.isPremium ? 'SI' : 'NO'}

Últimas transacciones: ${JSON.stringify(c.recentTransactions)}

Debes analizar el mensaje del usuario y devolver SIEMPRE un JSON válido con esta estructura:

{
  "intent": "register_expense" | "register_income" | "query" | "onboarding_name" | "chat" | "help" | "upgrade",
  "amount": <número en COP, 0 si no aplica>,
  "category": "<categoría en español: Alimentacion, Transporte, Vivienda, Servicios, Salud, Educacion, Entretenimiento, Ropa, Ahorro, Salario, Freelance, Otros>",
  "subcategory": "<subcategoría>",
  "description": "<descripción corta>",
  "date": "<hoy, ayer, fecha específica>",
  "needs_confirmation": true/false,
  "response": "<tu respuesta empática y motivadora en español>"
}

Conceptos clave:
- register_expense: cuando el usuario reporta un gasto ("gasté 18k en almuerzo", "pagué 50mil de mercado")
- register_income: cuando reporta ingreso ("recibí sueldo", "me pagaron 2 millones")
- query: cuando pregunta sobre su dinero ("cuánto tengo?", "cuánto gasté hoy?")
- onboarding_name: PRIMERA INTERACCIÓN - responde al nombre
- chat: conversación casual, saludos, agradecimientos
- help: cuando pide ayuda o no sabes qué quiere
- upgrade: cuando pregunta por premium o suscripción

Reglas de personalidad:
1. NUNCA uses miedo o culpa. Usa esperanza, control, pequeñas victorias.
2. Sé cálido y cercano, como un amigo que entiende de finanzas.
3. Usa un tono motivador pero realista. No prometas riqueza.
4. Cuando registres un gasto, sé neutral y constructivo.
5. Cuando registres un ingreso, celebra con el usuario.
6. Para queries, da información clara y útil.
7. Si no entiendes, pide aclaración amablemente.

Reglas de negocio:
- Los montos vienen en COP. El usuario puede decir "18k", "18 mil" = 18000
- El usuario tiene ${c.trialDaysLeft} días de prueba gratis de ${30} días.
- Premium cuesta $30.000 COP/mes. No lo promociones agresivamente.
- needs_confirmation debe ser TRUE para registros de gastos/ingresos.`;
}

async function interpret(message, userSession) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes('TU_') || key.includes('AQUI') || key.length < 20) {
        logger.warn('financeAi: Gemini key no disponible, usando fallback');
        return fallbackInterpret(message, userSession);
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
        model: 'models/gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = buildSystemPrompt(userSession) + `\n\nMensaje del usuario: "${message}"`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
            ]);
            const response = await result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) text = text.slice(7, -3).trim();
            else if (text.startsWith('```')) text = text.slice(3, -3).trim();
            const parsed = JSON.parse(text);
            if (!parsed.intent) parsed.intent = 'chat';
            return parsed;
        } catch (e) {
            logger.warn(`financeAi intento ${attempt}: ${e.message}`);
            if (attempt < 2) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
        }
    }
    return fallbackInterpret(message, userSession);
}

function stripAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cleanDescription(rawDesc, amount) {
    let d = rawDesc.trim();
    // Remove the parsed amount as raw number string
    const amountStr = String(amount);
    if (d.includes(amountStr)) {
        d = d.replace(amountStr, '');
    }
    // Remove raw number patterns like "18 mil", "2 millones", "50k" (order: longest first)
    d = d.replace(/\d[\d.]*\s*(?:millones|millon|mil|k)/gi, '');
    // Remove standalone "mil", "millon", "millones" (left after removing digits)
    d = d.replace(/\b(millones|millon|mil|k)\b/gi, '');
    // Remove common filler/verb words
    d = d.replace(/\b(gaste|pague|pagar|compre|compro|costo|valio|recibi|gane|ingreso|ingrese|pago|pagaron|de|en|por|un|una|el|la|los|las|del|que|con|para|mi|se)\b/gi, ' ');
    // Remove any remaining digits
    d = d.replace(/\d[\d.]*/g, '');
    // Remove extra whitespace
    d = d.replace(/\s+/g, ' ').trim();
    // Capitalize first letter
    if (d.length > 0) {
        d = d[0].toUpperCase() + d.slice(1);
    }
    // Fallback: if nothing remains, use raw desc truncated
    if (!d) {
        d = rawDesc.replace(/\d[\d.]*\s*(?:millones|millon|mil|k)?/gi, '').replace(/\s+/g, ' ').trim();
        if (d.length > 0) d = d[0].toUpperCase() + d.slice(1);
        return d.substring(0, 50);
    }
    return d.substring(0, 50);
}

const CATEGORY_KEYWORDS = {
    'Transporte': ['didi', 'uber', 'transporte', 'gasolina', 'bus', 'taxi', 'mototaxi', 'colectivo', 'combustible', 'pasaje', 'peaje', 'parqueadero', 'estacionamiento'],
    'Comida': ['almuerzo', 'pizza', 'cafe', 'capuchino', 'tinto', 'comida', 'desayuno', 'cena', 'mercado', 'restaurante', 'hamburguesa', 'perro', 'salchipapa', 'gaseosa', 'bebida', 'helado', 'mecato', 'lonche', 'pan', 'arepa', 'empanada', 'sandwich'],
    'Servicios': ['arreglo', 'reparacion', 'celular', 'mantenimiento', 'taller', 'mecanico', 'tecnico', 'instalacion', 'service'],
    'Salud': ['medico', 'medicina', 'farmacia', 'drogueria', 'hospital', 'clinica', 'cita', 'odontologo', 'examen', 'cirugia'],
    'Educacion': ['curso', 'clase', 'universidad', 'colegio', 'estudio', 'libro', 'mensualidad', 'matricula'],
    'Vivienda': ['arriendo', 'renta', 'agua', 'luz', 'energia', 'gas', 'internet', 'servicios'],
    'Ropa': ['ropa', 'zapatos', 'vestido', 'camisa', 'pantalon', 'tenis', 'accesorio'],
    'Entretenimiento': ['cine', 'teatro', 'concierto', 'fiesta', 'juego', 'suscripcion', 'netflix', 'spotify', 'streaming'],
    'Ahorro': ['ahorro', 'ahorros', 'alcancia', 'inversion']
};

const INCOME_CATEGORY_KEYWORDS = {
    'Salario': ['sueldo', 'salario', 'nomina', 'pago mensual'],
    'Freelance': ['freelance', 'trabajo', 'contrato', 'proyecto'],
    'Ventas': ['venta', 'ventas', 'domicilio', 'servicio prestado', 'comision', 'propina'],
    'Inversion': ['inversion', 'interes', 'dividendo', 'ganancia'],
    'Otros': []
};

function categorizeExpense(desc) {
    const t = desc.toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (t.includes(kw)) return cat;
        }
    }
    return 'Otros';
}

function categorizeIncome(desc) {
    const t = desc.toLowerCase();
    for (const [cat, keywords] of Object.entries(INCOME_CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (t.includes(kw)) return cat;
        }
    }
    return 'Otros';
}

function parseAmount(text) {
    // "18 mil" -> 18000, "18k" -> 18000, "18.000" -> 18000
    // "2 millones" -> 2000000, "1.5 millones" -> 1500000
    const normalized = text.toLowerCase().replace(/[,$\s]/g, '');
    // millones ("2 millones" -> 2000000, "1.5 millones" -> 1500000)
    const millMatch = normalized.match(/(\d[\d.]*)\s*(?:millon|millones)/);
    if (millMatch) {
        return Math.round(parseFloat(millMatch[1]) * 1000000);
    }
    // mil / k ("18 mil" -> 18000, "25k" -> 25000)
    const milMatch = normalized.match(/(\d[\d.]*)\s*(?:mil|k)/);
    if (milMatch) {
        return Math.round(parseFloat(milMatch[1]) * 1000);
    }
    // simple number ("50000", "18.000" -> 18000)
    const simpleMatch = normalized.match(/(\d[\d.]*)/);
    if (simpleMatch) {
        // Try as decimal first ("1.5" -> 1.5, "18.000" -> 18000)
        const val = parseFloat(simpleMatch[1]);
        // If it has a decimal point and the part after is short (< 3 digits), keep as decimal
        if (simpleMatch[1].includes('.') && simpleMatch[1].split('.')[1].length < 3) {
            return Math.round(val);
        }
        // Otherwise treat as integer (remove dots: "18.000" -> "18000")
        return parseInt(simpleMatch[1].replace(/\./g, '')) || 0;
    }
    return 0;
}

function fallbackInterpret(message, userSession) {
    const t = stripAccents(message.toLowerCase().trim());
    const raw = message.trim(); // original for descriptions
    const fin = userSession.finance || {};
    const name = fin.name;

    if (!name) {
        return {
            intent: 'onboarding_name',
            amount: 0,
            category: '',
            description: '',
            response: `🦁 ¡Rrrraaawr! Soy Leo. ¿Cómo te llamo?`,
            needs_confirmation: false
        };
    }

    // Expense patterns: "gaste 18 mil en almuerzo", "pague 50k de mercado", etc.
    const gastoPat = /(?:gaste|pague|compre|costo|valio|compre|compro|gasto)\s+(?:un[oa]|el|la|los|las)?\s*(.+)/i;
    const gastoMatch = t.match(gastoPat);
    if (gastoMatch) {
        const rawDesc = gastoMatch[1].trim();
        const amount = parseAmount(raw);
        if (amount > 0) {
            const desc = cleanDescription(rawDesc, amount);
            return {
                intent: 'register_expense',
                amount,
                category: categorizeExpense(desc),
                description: desc,
                needs_confirmation: true,
                response: `📝 *Registrado:* $${amount.toLocaleString('es-CO')} en ${desc}\n\n¿Es correcto? (sí/no)`
            };
        }
    }

    // Income patterns: "recibi 2 millones de sueldo", "me pagaron 500k", etc.
    const ingresoPat = /(?:recibi|gane|ingreso|recibi|ingrese|pago|pagaron|me\s+pagaron)\s+(?:de|en|por)?\s*(.+)/i;
    const ingresoMatch = t.match(ingresoPat);
    if (ingresoMatch) {
        const rawDesc = ingresoMatch[1].trim();
        const amount = parseAmount(raw);
        if (amount > 0) {
            const desc = cleanDescription(rawDesc, amount);
            return {
                intent: 'register_income',
                amount,
                category: categorizeIncome(desc),
                description: desc,
                needs_confirmation: true,
                response: `💰 *Registrado:* $${amount.toLocaleString('es-CO')} - ${desc}\n\n¿Es correcto? (sí/no)`
            };
        }
    }

    // Generic bidirectional: any number + remaining text -> expense
    // Covers: "20000 arreglo celular", "arreglo celular 20000", "8000 de pizza"
    const anyAmount = parseAmount(raw);
    if (anyAmount > 0) {
        // Determine intent: income if income-related keywords present
        const isIncome = /recibi|gane|ingreso|pago|pagaron|sueldo|salario|nomina|nomina/i.test(t);
        const rawDesc = isIncome
            ? raw.replace(/recibi|gane|ingreso|pago|pagaron|me\s+pagaron/gi, '').trim()
            : raw.replace(/gaste|pague|compre|costo|valio|gasto/i, '').trim();
        const desc = cleanDescription(rawDesc, anyAmount);
        if (desc.length > 0) {
            return {
                intent: isIncome ? 'register_income' : 'register_expense',
                amount: anyAmount,
                category: isIncome ? categorizeIncome(desc) : categorizeExpense(desc),
                description: desc,
                needs_confirmation: true,
                response: isIncome
                    ? `💰 *Registrado:* $${anyAmount.toLocaleString('es-CO')} - ${desc}\n\n¿Es correcto? (sí/no)`
                    : `📝 *Registrado:* $${anyAmount.toLocaleString('es-CO')} en ${desc}\n\n¿Es correcto? (sí/no)`
            };
        }
    }

    // Meta detection (separate from query)
    if (/\bmeta(s| financiera)?\b/i.test(t)) {
        return {
            intent: 'goals',
            amount: 0, category: '', description: '',
            needs_confirmation: false,
            response: `🎯 ¡Excelente que pienses en metas, ${name}! Decime: ¿para qué querés ahorrar? (ej: "un viaje", "un carro", "emergencias")`
        };
    }

    // Query patterns: "cuanto tengo", "saldo", "resumen diario", "como voy", etc.
    if (/cuanto\s+(tengo|gaste|dinero|plata|saldo|hay|gasto)/i.test(t) || /\bsaldo\b/i.test(t) ||
        /^(resumen|resumen diario|como voy|cuanto llevo|estado|status|reporte)/i.test(t)) {
        const balance = fin.balance || 0;
        const today = fin.todaySpending || 0;
        const goal = fin.goalName && fin.goalTarget ? fin.goalTarget : null;
        const goalLine = goal
            ? `🎯 Meta: ${fin.goalName} — $${(fin.balance || 0).toLocaleString('es-CO')} de $${goal.toLocaleString('es-CO')} (${Math.min(100, Math.round((fin.balance || 0) / goal * 100))}%)\n`
            : `💡 ¿Ya tenés una meta de ahorro? Decime "metas" y la creamos juntos 🦁\n`;
        return {
            intent: 'query',
            amount: 0,
            category: '',
            description: '',
            needs_confirmation: false,
            response: `📊 *Tu estado financiero ${name}:*\n\n💵 Saldo disponible: $${balance.toLocaleString('es-CO')}\n💸 Gastado hoy: $${today.toLocaleString('es-CO')}\n📈 Transacciones: ${(fin.transactions || []).length}\n${goalLine}\n¿Necesitas algo más?`
        };
    }

    // Ayuda
    if (/^(ayuda|help|que puedes hacer|comandos|menu)/i.test(t)) {
        return {
            intent: 'help',
            amount: 0, category: '', description: '',
            needs_confirmation: false,
            response: `😊 *${name}*, puedes decirme cosas como:\n\n` +
                `💸 *"Gasté 18 mil en almuerzo"*\n` +
                `💰 *"Recibí 2 millones de sueldo"*\n` +
                `📊 *"¿Cuánto tengo?"*\n` +
                `📷 *[foto de factura]*\n\n¿Qué quieres hacer?`
        };
    }

    return {
        intent: 'chat',
        amount: 0,
        category: '',
        description: '',
        needs_confirmation: false,
        response: `😊 Hola ${name}. Puedes decirme cosas como:\n\n• "Gasté 18 mil en almuerzo"\n• "Recibí 2 millones de sueldo"\n• "¿Cuánto tengo?"\n\n¿Qué quieres hacer?`
    };
}

module.exports = { interpret };
