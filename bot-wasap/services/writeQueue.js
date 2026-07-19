// Cola de escritura secuencial para API calls a Google Sheets
// Google Sheets NO soporta escrituras concurrentes (rate limiting + ECONNREFUSED)
// Esta cola serializa todas las peticiones POST a registrar_lead

const axios = require('axios');

class WriteQueue {
    constructor() {
        this._queue = [];
        this._processing = false;
        this._stats = { total: 0, ok: 0, fail: 0, retries: 0 };
    }

    // Agrega una tarea a la cola
    // fn debe retornar { ok, status, data } o hacer un throw
    async enqueue(url, payload, options = {}) {
        const { retries = 3, timeout = 15000, priority = 0 } = options;

        return new Promise((resolve) => {
            this._queue.push({ url, payload, retries, timeout, priority, resolve, attempt: 0 });
            this._queue.sort((a, b) => b.priority - a.priority); // mayor prioridad primero
            this._process();
        });
    }

    async _process() {
        if (this._processing || this._queue.length === 0) return;
        this._processing = true;

        while (this._queue.length > 0) {
            const task = this._queue.shift();
            task.attempt++;
            this._stats.total++;

            try {
                const resp = await axios.post(task.url, task.payload, { timeout: task.timeout });
                this._stats.ok++;
                task.resolve({ ok: true, status: resp.status, data: resp.data });
            } catch (e) {
                const isConnRefused = e.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED');
                const isTimeout = e.code === 'ECONNABORTED' || e.message.includes('timeout');
                const isRateLimit = e.response && e.response.status === 429;

                if ((isConnRefused || isTimeout || isRateLimit) && task.attempt <= task.retries) {
                    this._stats.retries++;
                    const delay = Math.min(1000 * Math.pow(2, task.attempt - 1), 8000); // backoff: 1s, 2s, 4s, 8s
                    this._queue.unshift(task); // re-encolar al inicio
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    this._stats.fail++;
                    task.resolve({
                        ok: false,
                        error: e.message,
                        status: e.response ? e.response.status : null,
                        data: e.response ? e.response.data : null
                    });
                }
            }
        }

        this._processing = false;
    }

    getStats() {
        return { ...this._stats, pending: this._queue.length };
    }

    resetStats() {
        this._stats = { total: 0, ok: 0, fail: 0, retries: 0 };
    }
}

module.exports = new WriteQueue();
