'use strict';

const { getBusiness } = require('../../config/businesses');

const adapters = {
    pilates: require('./pilates'),
    pilates_creditos: require('./pilatesCreditos'),
    finance: require('./finance')
};

/**
 * @returns {{available:boolean, leads?:Array, reason?:string}}
 */
async function getLeads(businessKey) {
    const business = getBusiness(businessKey);
    if (!business || !business.leadsAdapter) {
        return { available: false, reason: 'No disponible todavía para este negocio.' };
    }
    const adapter = adapters[business.leadsAdapter];
    if (!adapter) {
        return { available: false, reason: 'No disponible todavía para este negocio.' };
    }
    const leads = await adapter.getLeads({ limit: 100 });
    return { available: true, leads };
}

module.exports = { getLeads };
