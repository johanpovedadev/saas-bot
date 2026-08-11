'use strict';

const { createCanvas } = require('canvas');
const path = require('path');
const fs = require('fs');

const CARD_DIR = path.join(__dirname, '..', 'data', 'cards');
const WIDTH = 600;
const HEIGHT = 400;
const CORNER = 20;

const MILESTONES = {
    'first-tx': { icon: '🎉', label: '¡Primer registro!', color: '#4CAF50', sub: 'El primer paso es el más importante' },
    'streak-3': { icon: '🔥', label: '¡3 días seguidos!', color: '#FF9800', sub: 'Ya estás cogiendo el ritmo' },
    'streak-7': { icon: '🌟', label: '¡7 días! Una semana', color: '#9C27B0', sub: 'La constancia es lo que cuenta' },
    'streak-30': { icon: '🏆', label: '¡30 días! Imparable', color: '#FFD700', sub: 'Un mes completo. Eres un león' },
    'goal-25': { icon: '📈', label: '25% de tu meta', color: '#2196F3', sub: 'Ya vas camino a cumplirla' },
    'goal-50': { icon: '🎯', label: '¡Mitad de la meta!', color: '#00BCD4', sub: 'Vas por la mitad. Sigue así' },
    'goal-75': { icon: '🏁', label: '¡75% de tu meta!', color: '#8BC34A', sub: 'Ya casi lo lográs. No aflojes' },
    'goal-100': { icon: '🚀', label: '¡META CUMPLIDA!', color: '#FF5722', sub: 'LO LOGRASTE. Celebra este logro' },
};

// Set predefinido de "imagen" (emoji) por tipo de meta. La elección es
// automática según el nombre que escribe el usuario ("viaje", "casa", ...).
const GOAL_TYPES = {
    'viaje': { key: 'viaje', emoji: '✈️' },
    'vacacion': { key: 'vacacion', emoji: '✈️' },
    'casa': { key: 'casa', emoji: '🏠' },
    'apartamento': { key: 'casa', emoji: '🏠' },
    'emergencia': { key: 'emergencia', emoji: '🛡️' },
    'colchon': { key: 'emergencia', emoji: '🛡️' },
    'imprevisto': { key: 'emergencia', emoji: '🛡️' },
    'carro': { key: 'carro', emoji: '🚗' },
    'moto': { key: 'moto', emoji: '🏍️' },
    'deuda': { key: 'deuda', emoji: '📉' },
    'educacion': { key: 'educacion', emoji: '🎓' },
    'estudio': { key: 'educacion', emoji: '🎓' },
    'regalo': { key: 'regalo', emoji: '🎁' },
    'boda': { key: 'boda', emoji: '💍' },
    'navidad': { key: 'navidad', emoji: '🎄' },
    'inversion': { key: 'inversion', emoji: '📈' },
    'negocio': { key: 'negocio', emoji: '💼' },
    'ahorro': { key: 'ahorro', emoji: '💰' }
};

function getGoalType(name) {
    const n = String(name || '').toLowerCase();
    for (const [key, info] of Object.entries(GOAL_TYPES)) {
        if (n.includes(key)) return { key: info.key, emoji: info.emoji };
    }
    return { key: 'meta', emoji: '🎯' };
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function generateCard(userName, milestoneId, extra, goalEmoji) {
    const info = MILESTONES[milestoneId];
    if (!info) throw new Error(`Unknown milestone: ${milestoneId}`);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(0.5, '#16213e');
    grad.addColorStop(1, '#0f3460');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Accent stripe
    ctx.fillStyle = info.color;
    ctx.fillRect(0, 0, WIDTH, 6);

    // Leo logo badge
    ctx.fillStyle = hexToRgba(info.color, 0.15);
    drawRoundedRect(ctx, 20, 20, 80, 40, 20);
    ctx.fill();
    ctx.fillStyle = info.color;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('🦁 Leo', 38, 47);

    // Goal image badge (emoji del tipo de meta elegido al crear la meta)
    if (goalEmoji) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        drawRoundedRect(ctx, WIDTH - 90, 20, 60, 40, 20);
        ctx.fill();
        ctx.font = '24px sans-serif';
        ctx.fillText(goalEmoji, WIDTH - 66, 47);
    }

    // User name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    const name = userName || 'Usuario';
    ctx.fillText(name, 30, 120);

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 140);
    ctx.lineTo(WIDTH - 30, 140);
    ctx.stroke();

    // Milestone icon (big)
    ctx.font = '64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(info.icon, WIDTH / 2, 220);

    // Milestone label
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = info.color;
    ctx.fillText(info.label, WIDTH / 2, 275);

    // Subtitle
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(info.sub, WIDTH / 2, 305);

    ctx.textAlign = 'left';

    // Extra info (e.g., "Ahorrado: $150.000")
    if (extra) {
        ctx.font = '16px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(extra, 30, 345);
    }

    // Date
    const dateStr = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(dateStr, 30, HEIGHT - 20);

    // Branding
    ctx.textAlign = 'right';
    ctx.fillText('Leo Financiero', WIDTH - 30, HEIGHT - 20);
    ctx.textAlign = 'left';

    // Bottom stripe
    ctx.fillStyle = hexToRgba(info.color, 0.3);
    ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);

    // Ensure dir exists
    if (!fs.existsSync(CARD_DIR)) {
        fs.mkdirSync(CARD_DIR, { recursive: true });
    }

    const filePath = path.join(CARD_DIR, `${milestoneId}_${Date.now()}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

function getNewMilestones(fin, prevFin) {
    const milestones = [];
    const prev = prevFin || {};

    // First transaction
    if (fin.firstTransactionDone && !prev.firstTransactionDone) {
        milestones.push('first-tx');
    }

    // Streak milestones
    if (fin.streak >= 3 && (prev.streak || 0) < 3) {
        milestones.push('streak-3');
    }
    if (fin.streak >= 7 && (prev.streak || 0) < 7) {
        milestones.push('streak-7');
    }
    if (fin.streak >= 30 && (prev.streak || 0) < 30) {
        milestones.push('streak-30');
    }

    // Goal progress milestones
    if (fin.goalTarget > 0) {
        const pct = Math.min(100, Math.round((fin.balance || 0) / fin.goalTarget * 100));
        const prevPct = prev.goalTarget > 0 ? Math.min(100, Math.round((prev.balance || 0) / prev.goalTarget * 100)) : 0;
        if (pct >= 25 && prevPct < 25) milestones.push('goal-25');
        if (pct >= 50 && prevPct < 50) milestones.push('goal-50');
        if (pct >= 75 && prevPct < 75) milestones.push('goal-75');
        if (pct >= 100 && prevPct < 100) milestones.push('goal-100');
    }

    return milestones;
}

module.exports = { generateCard, getNewMilestones, MILESTONES, GOAL_TYPES, getGoalType };
