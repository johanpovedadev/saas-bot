'use strict';

async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
}

function fmtTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('es-CO');
}

// Una sola llamada a /api/businesses actualiza TODAS las tarjetas (antes
// cada tarjeta pedia esto por separado en su propio intervalo -> con 4
// negocios eran 4 llamadas redundantes cada 10s, cada una disparando un
// "pm2 jlist" por detras).
async function refreshAllStatuses() {
    try {
        const { businesses } = await api('/businesses');
        businesses.forEach(info => {
            const card = document.querySelector(`.card[data-key="${info.key}"]`);
            if (!card) return;
            const badge = card.querySelector('[data-status-badge]');
            const online = info.status === 'online';
            badge.textContent = online ? 'En línea' : (info.status === 'stopped' ? 'Apagado' : info.status);
            badge.className = `status-badge ${online ? 'online' : (info.status === 'stopped' ? 'stopped' : '')}`;
            card.querySelector('[data-pid]').textContent = info.pid || '—';
            card.querySelector('[data-owner]').textContent = info.ownerJid ? info.ownerJid.split('@')[0] : '—';
        });
    } catch (e) {
        console.error('refreshAllStatuses', e);
    }
}

async function refreshCardDetails(card) {
    await refreshMuted(card);
    await refreshLogs(card);
    await refreshLeads(card);
}

async function refreshMuted(card) {
    const list = card.querySelector('[data-muted-list]');
    if (!list) return; // Telegram card no tiene esta seccion
    const key = card.dataset.key;
    try {
        const { muted } = await api(`/businesses/${key}/muted`);
        list.innerHTML = muted.length
            ? muted.map(jid => `<li>${jid.split('@')[0]}</li>`).join('')
            : '<li>Ningún número silenciado.</li>';
    } catch (e) {
        list.innerHTML = `<li>Error: ${e.message}</li>`;
    }
}

async function refreshLogs(card) {
    const viewer = card.querySelector('[data-log-viewer]');
    const key = card.dataset.key;
    try {
        const { lines } = await api(`/businesses/${key}/logs`);
        if (!lines.length) {
            viewer.textContent = 'Sin conversaciones registradas todavía.';
            return;
        }
        viewer.innerHTML = lines.slice(-30).map(l => `
            <div class="log-line ${l.isBot ? 'bot' : 'cliente'}">
                <span class="time">${fmtTime(l.time)}</span>
                <span class="who">${l.isBot ? '🤖' : '🧑'} ${l.jid ? l.jid.split('@')[0] : ''}</span>
                <span class="text">${escapeHtml(l.text).slice(0, 200)}</span>
            </div>
        `).join('');
        viewer.scrollTop = viewer.scrollHeight;
    } catch (e) {
        viewer.textContent = `Error: ${e.message}`;
    }
}

async function refreshLeads(card) {
    const viewer = card.querySelector('[data-leads-viewer]');
    const key = card.dataset.key;
    try {
        const data = await api(`/businesses/${key}/leads`);
        if (!data.available) {
            viewer.textContent = data.reason || 'No disponible.';
            return;
        }
        if (!data.leads.length) {
            viewer.textContent = 'Sin leads todavía.';
            return;
        }
        viewer.innerHTML = `
            <table class="leads-table">
                <thead><tr><th>Nombre</th><th>Teléfono</th><th>Detalle</th><th>Estado</th></tr></thead>
                <tbody>
                    ${data.leads.map(l => `<tr><td>${escapeHtml(l.nombre)}</td><td>${escapeHtml(l.telefono)}</td><td>${escapeHtml(l.detalle)}</td><td>${escapeHtml(l.estado)}</td></tr>`).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        viewer.textContent = `Error: ${e.message}`;
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wireCard(card) {
    const key = card.dataset.key;

    card.querySelector('[data-action="start"]').addEventListener('click', async () => {
        try {
            await api(`/businesses/${key}/start`, { method: 'POST' });
            setTimeout(refreshAllStatuses, 1500);
        } catch (e) { alert(e.message); }
    });

    card.querySelector('[data-action="stop"]').addEventListener('click', async () => {
        try {
            await api(`/businesses/${key}/stop`, { method: 'POST' });
            setTimeout(refreshAllStatuses, 1500);
        } catch (e) { alert(e.message); }
    });

    const muteBtn = card.querySelector('[data-action="mute"]');
    if (muteBtn) {
        muteBtn.addEventListener('click', async () => {
            const input = card.querySelector('[data-mute-input]');
            try {
                await api(`/businesses/${key}/mute`, { method: 'POST', body: JSON.stringify({ number: input.value }) });
                input.value = '';
                refreshMuted(card);
            } catch (e) { alert(e.message); }
        });
    }

    const unmuteBtn = card.querySelector('[data-action="unmute"]');
    if (unmuteBtn) {
        unmuteBtn.addEventListener('click', async () => {
            const input = card.querySelector('[data-mute-input]');
            try {
                await api(`/businesses/${key}/unmute`, { method: 'POST', body: JSON.stringify({ number: input.value }) });
                input.value = '';
                refreshMuted(card);
            } catch (e) { alert(e.message); }
        });
    }
}

const cards = document.querySelectorAll('.card');
cards.forEach(card => {
    wireCard(card);
    refreshCardDetails(card);
});
refreshAllStatuses();
setInterval(refreshAllStatuses, 10000);
setInterval(() => cards.forEach(refreshCardDetails), 15000);
