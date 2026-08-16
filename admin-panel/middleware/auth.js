'use strict';

function requireLogin(req, res, next) {
    if (!req.session.user) {
        // req.path es relativo al router donde se monta este middleware (ej.
        // "/businesses" dentro de apiRoutes, no "/api/businesses") - hay que
        // mirar originalUrl para detectar confiablemente una llamada a /api.
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
        return res.redirect('/login');
    }
    next();
}

/**
 * Permite si es super-admin, o si es la cuenta del negocio :key exacto.
 * Aplicar SIEMPRE en el servidor — nunca confiar solo en ocultar botones
 * en el cliente.
 */
function requireBusinessScope(req, res, next) {
    const key = req.params.key;
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    if (user.role === 'super' || user.businessKey === key) return next();
    return res.status(403).json({ error: 'No tenés permiso para este negocio.' });
}

module.exports = { requireLogin, requireBusinessScope };
