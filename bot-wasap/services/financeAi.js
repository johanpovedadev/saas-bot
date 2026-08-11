'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');

function buildFinanceContext(userSession) {
    const fin = userSession.finance || {};
    const tier = fin.tier || 'free';
    return {
        name: fin.name || '',
        balance: fin.balance || 0,
        todaySpending: fin.todaySpending || 0,
        totalTransactions: (fin.transactions || []).length,
        isPremium: !!fin.isPremium,
        tier,
        tierLabel: tier === 'master' ? 'Master (IA sin límites)'
            : tier === 'basic' ? 'Basic (60 interacciones de IA al mes)'
                : 'Gratis (sin IA)',
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
- Compras hoy: $${c.todaySpending.toLocaleString('es-CO')}
- Total transacciones: ${c.totalTransactions}
- Plan: ${c.tierLabel}
- Premium: ${c.isPremium ? 'SI' : 'NO'}

Últimas transacciones: ${JSON.stringify(c.recentTransactions)}

Debes analizar el mensaje del usuario y devolver SIEMPRE un JSON válido con esta estructura:

{
  "intent": "register_expense" | "register_income" | "query" | "health_score" | "onboarding_name" | "chat" | "help" | "upgrade" | "referral_info" | "referral_use",
  "amount": <número en COP, 0 si no aplica>,
  "category": "<categoría en español: Alimentacion, Transporte, Vivienda, Servicios, Salud, Educacion, Entretenimiento, Ropa, Ahorro, Salario, Freelance, Otros>",
  "subcategory": "<subcategoría>",
  "description": "<descripción corta>",
  "date": "<hoy, ayer, fecha específica>",
  "needs_confirmation": true/false,
  "response": "<tu respuesta empática y motivadora en español>"
}

Conceptos clave:
- register_expense: cuando el usuario reporta una compra ("compré 18k en almuerzo", "pagué 50mil de mercado")
- register_income: cuando reporta ingreso ("recibí sueldo", "me pagaron 2 millones")
- query: cuando pregunta sobre su dinero ("cuánto tengo?", "cuánto compré hoy?")
- health_score: cuando pregunta por su salud financiera o score ("salud", "score", "como van mis finanzas", "que tal va mi plata", "/salud")
- onboarding_name: PRIMERA INTERACCIÓN - responde al nombre
- chat: conversación casual, saludos, agradecimientos
- help: cuando pide ayuda o no sabes qué quiere
- upgrade: cuando pregunta por premium o suscripción
- referral_info: cuando pregunta por su código de invitación, cómo invitar amigos ("referido", "invitar", "código de invitación", "compartir", "amigue")
- referral_use: cuando escribe un código de invitación como "LEO77115"

Reglas de personalidad:
1. NUNCA uses miedo o culpa. Usa esperanza, control, pequeñas victorias.
2. Sé cálido y cercano, como un amigo que entiende de finanzas.
3. Usa un tono motivador pero realista. No prometas riqueza.
4. Cuando registres una compra, sé neutral y constructivo.
5. Cuando registres un ingreso, celebra con el usuario.
6. Para queries, da información clara y útil.
7. Si no entiendes, pide aclaración amablemente.

Reglas de negocio:
- Los montos vienen en COP. El usuario puede decir "18k", "18 mil" = 18000
- El usuario tiene el plan ${c.tierLabel}. No lo promociones agresivamente.
- Planes de referencia: Basic $15.000 COP/mes (60 interacciones IA), Master $30.000 COP/mes (IA ilimitada).
- needs_confirmation debe ser TRUE para registros de compras/ingresos.`;
}

async function interpret(message, userSession) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes('TU_') || key.includes('AQUI') || key.length < 20) {
        logger.warn('financeAi: Gemini key no disponible, usando fallback');
        return fallbackInterpret(message, userSession);
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
        model: 'models/gemini-2.0-flash',
        generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = buildSystemPrompt(userSession) + `\n\nMensaje del usuario: "${message}"`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20000))
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

async function interpretAudio(audioBase64, userSession) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes('TU_') || key.length < 20) {
        logger.warn('financeAi: Gemini key no disponible para audio');
        return null;
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash' });

    const prompt = `Eres un asistente de transcripción. Transcribe EXACTAMENTE lo que dice el usuario en este mensaje de voz. No agregues nada, no interpretes, solo transcribe. Si el usuario menciona un gasto, cantidad o monto, inclúyelo tal cual lo dijo. Ejemplos de salidas correctas:\n- "Compré almuerzo por quince mil pesos"\n- "Ayer gasté treinta mil en el mercado"\n- "Hoy pagué el servicio de luz"\n- "Hola Leo, ¿cómo estás?"`;

    try {
        const audioPart = {
            inlineData: {
                mimeType: 'audio/ogg; codecs=opus',
                data: audioBase64
            }
        };
        const result = await Promise.race([
            model.generateContent([prompt, audioPart]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);
        const response = await result.response;
        const text = response.text().trim();
        if (!text) return null;
        logger.info(`financeAi interpretAudio transcripción: "${text.substring(0, 80)}"`);
        return text;
    } catch (e) {
        logger.error(`financeAi interpretAudio: ${e.message}`);
        return null;
    }
}

async function interpretImage(imageBase64, userSession, mimeType = 'image/jpeg') {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes('TU_') || key.length < 20) {
        logger.warn('financeAi: Gemini key no disponible para imagen');
        return null;
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash' });

    const prompt = `Eres un asistente que lee facturas, recibos y tiquetes. Lee esta imagen y extrae el monto total y la descripción del negocio o producto. Responde en UNA SOLA línea con este formato exacto:\nCompré [descripción del negocio/producto] por [monto] pesos\nEjemplo: "Compré Almacén Éxito por 45000 pesos"\nSi no puedes leer la factura, responde con lo que veas en la imagen.`;

    try {
        const imagePart = {
            inlineData: {
                mimeType: mimeType,
                data: imageBase64
            }
        };
        const result = await Promise.race([
            model.generateContent([prompt, imagePart]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);
        const response = await result.response;
        const text = response.text().trim();
        if (!text) return null;
        logger.info(`financeAi interpretImage lectura: "${text.substring(0, 80)}"`);
        return text;
    } catch (e) {
        logger.error(`financeAi interpretImage: ${e.message}`);
        return null;
    }
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
    d = d.replace(/\b(compre|compro|compra|gaste|pague|pagar|costo|valio|recibi|gane|ingreso|ingrese|pago|pagaron|de|en|por|un|una|el|la|los|las|del|que|con|para|mi|se)\b/gi, ' ');
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

function goalProgressBar(current, target) {
    if (!target || target <= 0) return '';
    const pct = Math.min(100, Math.round((current / target) * 100));
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}% — llevás $${current.toLocaleString('es-CO')} de $${target.toLocaleString('es-CO')}`;
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
    const gastoPat = /(?:compre|compro|compra|gaste|pague|costo|valio)\s+(?:un[oa]|el|la|los|las)?\s*(.+)/i;
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

    // Referral code pattern: LEO + 4-6 digits
    if (/^leo\d{4,6}$/i.test(t)) {
        const code = raw.match(/LEO\d{4,6}/i)?.[0] || '';
        return {
            intent: 'referral_use',
            amount: 0, category: '', description: code,
            needs_confirmation: true,
            response: `🦁 ¿Te invitó alguien con el código *${code.toUpperCase()}*?\n\nResponde *sí* para aceptar o *no* para cancelar.`
        };
    }

    // Referral info: user asking about their own code
    if (/\b(referido|invitar|invitaci[oó]n|c[oó]digo\s+de\s+invitaci[oó]n|recomendar|compartir\s+c[oó]digo|c[oó]mo\s+invito|amigue|invita)\b/i.test(t)) {
        return {
            intent: 'referral_info',
            amount: 0, category: '', description: '',
            needs_confirmation: false,
            response: 'referral_info'
        };
    }

    // Generic bidirectional: any number + remaining text -> expense
    // Covers: "20000 arreglo celular", "arreglo celular 20000", "8000 de pizza"
    const anyAmount = parseAmount(raw);
    if (anyAmount > 0) {
        // Determine intent: income if income-related keywords present
        const isIncome = /recibi|gane|ingreso|pago|pagaron|sueldo|salario|nomina|nomina/i.test(t);
        const rawDesc = isIncome
            ? raw.replace(/recibi|gane|ingreso|pago|pagaron|me\s+pagaron/gi, '').trim()
            : raw.replace(/compre|compro|compra|gaste|pague|costo|valio/gi, '').trim();
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

    // Goal query: "mi meta", "como voy con mi meta", "cuanto me falta"
    if (/mi meta|como voy con mi meta|cuanto (me falta|falta|voy)|progreso/i.test(t)) {
        if (fin.goalName) {
            if (fin.goalTarget > 0) {
                const bar = goalProgressBar(fin.balance || 0, fin.goalTarget);
                return { intent: 'goal_query', amount: 0, category: '', description: '', needs_confirmation: false,
                    response: `🎯 *Meta: ${fin.goalName}*\n${bar}\n\nVas bien, seguí así 🦁` };
            }
            return { intent: 'goal_query', amount: 0, category: '', description: '', needs_confirmation: false,
                response: `🦁 Aún no le pusiste un número a tu meta de "${fin.goalName}". ¿Cuánto te gustaría juntar? Así te muestro cuánto te falta.` };
        }
        return { intent: 'goal_query', amount: 0, category: '', description: '', needs_confirmation: false,
            response: `🦁 Todavía no tenés una meta. Decime "metas" y la creamos juntos.` };
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

    // Health score: "/salud", "salud financiera", "¿cómo van mis finanzas?",
    // "¿qué tal mi score?" (va ANTES de los patrones de query para no ser capturado)
    if (/^\/?salud/i.test(t) || /(salud financiera|score|mis finanzas|como van mis finanzas|como voy con mis finanzas|como va mi plata|como voy de plata|como estoy de plata|como estoy (economica|financieramente|de salud)|que tal (esta|mi) (salud|score)|estado de (mi|la)?\s*salud|health)/i.test(t)) {
        return {
            intent: 'health_score',
            amount: 0, category: '', description: '',
            needs_confirmation: false,
            response: 'health_score'
        };
    }

    // Query patterns: "cuanto tengo", "saldo", "resumen diario", "como voy", etc.
    if (/cuanto\s+(tengo|compre|compres|dinero|plata|saldo|hay)/i.test(t) || /\bsaldo\b/i.test(t) ||
        /^(resumen|resumen diario|como voy|cuanto llevo|estado|status|reporte)/i.test(t)) {
        const balance = fin.balance || 0;
        const today = fin.todaySpending || 0;
        const goalLine = fin.goalName
            ? (fin.goalTarget > 0
                ? `🎯 Meta: ${fin.goalName}\n${goalProgressBar(balance, fin.goalTarget)}\n`
                : `🎯 Meta: ${fin.goalName} (sin monto aún — decime "mi meta" para ponérselo)\n`)
            : `💡 ¿Ya tenés una meta de ahorro? Decime "metas" y la creamos juntos 🦁\n`;
        return {
            intent: 'query',
            amount: 0,
            category: '',
            description: '',
            needs_confirmation: false,
            response: `📊 *Tu estado financiero ${name}:*\n\n💵 Saldo disponible: $${balance.toLocaleString('es-CO')}\n💸 Comprado hoy: $${today.toLocaleString('es-CO')}\n📈 Transacciones: ${(fin.transactions || []).length}\n${goalLine}\n¿Necesitas algo más?`
        };
    }

    // Ayuda
    if (/^(ayuda|help|que puedes hacer|comandos|menu)/i.test(t)) {
        return {
            intent: 'help',
            amount: 0, category: '', description: '',
            needs_confirmation: false,
            response: `😊 *${name}*, puedes decirme cosas como:\n\n` +
                `💸 *"Compré 18 mil en almuerzo"*\n` +
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
        response: `😊 Hola ${name}. Puedes decirme cosas como:\n\n• "Compré 18 mil en almuerzo"\n• "Recibí 2 millones de sueldo"\n• "¿Cuánto tengo?"\n\n¿Qué quieres hacer?`
    };
}

module.exports = { interpret, interpretAudio, interpretImage };
