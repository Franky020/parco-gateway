'use strict';
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const cron = require('node-cron');
const app = express();

app.use(express.json());

// Middleware de autenticación
app.use(function (req, res, next) {
    const key = req.headers['gateway_access_key'] || req.query.access_key;
    if (key !== process.env.GATEWAY_KEY) {
        return res.status(401).json({ message: 'Invalid access key', code: 401 });
    }
    next();
});

// Rutas
app.use('/api/entervo', require('./routes/entervo'));

// 404
app.use(function (req, res) {
    res.status(404).json({ message: `Resource from URL ${req.url} not found on method ${req.method}.`, code: 404 });
});

// Error handler
app.use(function (err, req, res, next) {
    res.status(500).json({ message: err.message, code: 500 });
});

// Liquidación diaria a las 4 AM
cron.schedule('0 4 * * *', async function () {
    console.log('Liquidación diaria — cerrando turno activo...');
    try {
        const helpers = require('./helpers');
        const $helpers = new helpers();
        const shift = await $helpers.shift();
        await $helpers.closeShift(shift);
        console.log('Turno cerrado exitosamente:', shift.shiftId);
    } catch (err) {
        console.log('Error en liquidación diaria:', err.message);
    }
}, {
    timezone: 'America/Mexico_City'
});

const PORT = process.env.PORT || 8443;

try {
    const options = {
        key  : fs.readFileSync('./ssl.key'),
        cert : fs.readFileSync('./ssl.crt')
    };
    https.createServer(options, app).listen(PORT, '0.0.0.0', function () {
        console.log(`Parco Gateway running on https://0.0.0.0:${PORT}`);
    });
} catch (err) {
    console.log('SSL not found, starting HTTP:', err.message);
    app.listen(PORT, '0.0.0.0', function () {
        console.log(`Parco Gateway running on http://0.0.0.0:${PORT}`);
    });
}