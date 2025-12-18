const { parseOrderText } = require('./parseOrderText');
const assert = require('assert');

function t(input, expected) {
    const res = parseOrderText(input);
    console.log(input, '=>', res);
    if (expected.quantity !== undefined) assert.strictEqual(res.parsed.quantity, expected.quantity);
    if (expected.unit !== undefined) assert.strictEqual(res.parsed.unit, expected.unit);
    if (expected.product_name !== undefined) assert.strictEqual(res.parsed.product_name, expected.product_name);
    if (expected.toppings !== undefined) {
        if (expected.toppings === 'empty') assert.deepStrictEqual(res.parsed.toppings, []);
        else assert.strictEqual(res.parsed.toppings, null);
    }
}

// Tests
try {
    t('Necesito 3 cajas de helado vainilla, sin toppings', { quantity: 3, unit: 'caja', product_name: 'helado vainilla', toppings: 'empty' });
    t('3 cajas vainilla', { quantity: 3, unit: 'caja', product_name: 'vainilla' });
    t('Quiero 1 docena de empanadas', { quantity: 1, unit: 'docena', product_name: 'empanadas' });
    t('Necesito 2 kilos de queso', { quantity: 2, unit: 'kg', product_name: 'queso' });
    t('Vainilla, sin', { quantity: null, unit: null, product_name: 'vainilla', toppings: 'empty' });
    console.log('All parseOrderText tests passed');
    process.exit(0);
} catch (e) {
    console.error('Test failed:', e.message);
    process.exit(1);
}
