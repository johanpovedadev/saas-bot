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
    await refreshQr(card);
    await refreshMuted(card);
    await refreshWaitingHuman(card);
    await refreshLogs(card);
    await refreshLeads(card);
    await refreshFinanceStats(card);
}

async function refreshQr(card) {
    const section = card.querySelector('[data-qr-section]');
    if (!section) return; // Telegram no tiene esta seccion
    const key = card.dataset.key;
    try {
        const { exists, fresh } = await api(`/businesses/${key}/qr-status`);
        if (!exists || !fresh) {
            section.style.display = 'none';
            return;
        }
        const img = card.querySelector('[data-qr-image]');
        img.src = `/api/businesses/${key}/qr.png?t=${Date.now()}`;
        section.style.display = '';
    } catch (e) {
        section.style.display = 'none';
    }
}

async function refreshMuted(card) {
    const list = card.querySelector('[data-muted-list]');
    if (!list) return; // Telegram card no tiene esta seccion
    const key = card.dataset.key;
    try {
        const { muted } = await api(`/businesses/${key}/muted`);
        list.innerHTML = muted.length
            ? muted.map(jid => `<li>${jid.split('@')[0]} <button type="button" class="btn btn-unmute-one" data-unmute-jid="${jid.split('@')[0]}">Desilenciar ✕</button></li>`).join('')
            : '<li>Ningún número silenciado.</li>';
        // Boton directo por numero — antes habia que copiar el numero a mano
        // en la casilla de arriba, lo cual generaba dudas de si "el panel no
        // dejaba" desilenciar cuando en realidad si funcionaba.
        list.querySelectorAll('[data-unmute-jid]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await api(`/businesses/${key}/unmute`, { method: 'POST', body: JSON.stringify({ number: btn.dataset.unmuteJid }) });
                    refreshMuted(card);
                } catch (e) {
                    alert(e.message);
                    btn.disabled = false;
                }
            });
        });
    } catch (e) {
        list.innerHTML = `<li>Error: ${e.message}</li>`;
    }
}

// "hace 5 min" / "hace 2 h" / "hace 3 d" - legible sin ser una fecha completa.
function timeAgo(ms) {
    if (!ms) return '';
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return 'recién';
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.floor(hours / 24)} d`;
}

async function refreshWaitingHuman(card) {
    const list = card.querySelector('[data-waiting-human-list]');
    if (!list) return; // Telegram card no tiene esta seccion (Leo nunca se apaga)
    const key = card.dataset.key;
    try {
        const { waiting } = await api(`/businesses/${key}/waiting-human`);
        list.innerHTML = waiting.length
            ? waiting.map(w => `
                <li>
                  <span class="waiting-info">
                    <strong>${w.jid.split('@')[0]}</strong>
                    <span class="waiting-reason">${escapeHtml(w.reason || 'Esperando atención humana')} · ${timeAgo(w.since)}</span>
                  </span>
                  <button type="button" class="btn btn-unmute-one" data-reactivate-jid="${w.jid.split('@')[0]}">Reactivar ✕</button>
                </li>`).join('')
            : '<li>Nadie esperando atención humana ahora mismo.</li>';
        list.querySelectorAll('[data-reactivate-jid]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await api(`/businesses/${key}/reactivate`, { method: 'POST', body: JSON.stringify({ number: btn.dataset.reactivateJid }) });
                    refreshWaitingHuman(card);
                } catch (e) {
                    alert(e.message);
                    btn.disabled = false;
                }
            });
        });
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

async function refreshFinanceStats(card) {
    const box = card.querySelector('[data-finance-stats]');
    if (!box) return; // solo la tarjeta de finance tiene esta seccion
    const key = card.dataset.key;
    try {
        const { today, thisWeek, thisMonth } = await api(`/businesses/${key}/finance-stats`);
        card.querySelector('[data-finance-today]').textContent = today;
        card.querySelector('[data-finance-week]').textContent = thisWeek;
        card.querySelector('[data-finance-month]').textContent = thisMonth;
    } catch (e) {
        console.error('refreshFinanceStats', e);
    }
}

async function refreshLeads(card) {
    const viewer = card.querySelector('[data-leads-viewer]');
    const key = card.dataset.key;
    const hasCreditoForm = !!card.querySelector('[data-credito-telefono]');
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
                <thead><tr><th>Nombre</th><th>Teléfono</th><th>Detalle</th><th>Estado</th>${hasCreditoForm ? '<th></th>' : ''}</tr></thead>
                <tbody>
                    ${data.leads.map(l => `<tr>
                        <td>${escapeHtml(l.nombre)}</td>
                        <td>${escapeHtml(l.telefono)}</td>
                        <td>${escapeHtml(l.detalle)}</td>
                        <td>${escapeHtml(l.estado)}</td>
                        ${hasCreditoForm ? `<td><button type="button" class="btn btn-link" data-edit-credito data-telefono="${escapeHtml(l.telefono)}" data-nombre="${escapeHtml(l.nombre)}" data-clases="${l.allotment != null ? l.allotment : ''}">✏️ Editar</button></td>` : ''}
                    </tr>`).join('')}
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

    const creditoBtn = card.querySelector('[data-action="guardar-credito"]');
    if (creditoBtn) {
        creditoBtn.addEventListener('click', async () => {
            const telefono = card.querySelector('[data-credito-telefono]');
            const nombre = card.querySelector('[data-credito-nombre]');
            const clases = card.querySelector('[data-credito-clases]');
            try {
                await api(`/businesses/${key}/pilates-credito`, {
                    method: 'POST',
                    body: JSON.stringify({ telefono: telefono.value, nombre: nombre.value, clases: clases.value })
                });
                telefono.value = '';
                nombre.value = '';
                clases.value = '';
                refreshLeads(card);
            } catch (e) { alert(e.message); }
        });
    }

    // Boton "Editar" por fila en la tabla de creditos: precarga el form de
    // arriba con los datos de esa clienta. Delegado en el contenedor (la
    // tabla se reemplaza entera en cada refresh, un listener por boton se
    // perderia).
    const leadsViewer = card.querySelector('[data-leads-viewer]');
    if (leadsViewer) {
        leadsViewer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-edit-credito]');
            if (!btn) return;
            const telefono = card.querySelector('[data-credito-telefono]');
            const nombre = card.querySelector('[data-credito-nombre]');
            const clases = card.querySelector('[data-credito-clases]');
            if (telefono) telefono.value = btn.dataset.telefono || '';
            if (nombre) nombre.value = btn.dataset.nombre || '';
            if (clases) clases.value = btn.dataset.clases || '';
            if (telefono) telefono.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
