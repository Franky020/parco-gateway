'use strict';
const express = require('express');
const router = express.Router();
const helpers = require('../helpers');

// Balance - consultar ticket
router.post('/balance', async function (req, res) {
    try {
        let $helpers = new helpers();
        let result = await $helpers.balance({
            barcode : req.body.barcode,
            plate   : req.body.plate
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message, code: 500 });
    }
});

// Checkout - registrar pago
router.post('/checkout', async function (req, res) {
    try {
        if (req.body.amount && parseInt(req.body.amount) > 99900) {
            return res.status(400).json({ 
                message: 'Monto excede el límite permitido de $999.00', 
                code: 400 
            });
        }
        let $helpers = new helpers();
        let result = await $helpers.checkout({
            barcode : req.body.barcode,
            plate   : req.body.plate,
            amount  : req.body.amount
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message, code: 500 });
    }
});

// Stats - estado del servidor
router.get('/stats', async function (req, res) {
    try {
        let $helpers = new helpers();
        let result = await $helpers.stats();
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message, code: 500 });
    }
});

module.exports = router;