'use strict';
require('dotenv').config();
const express = require('express');
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

const PORT = process.env.PORT || 5102;
app.listen(PORT, '0.0.0.0', function () {
    console.log(`Parco Gateway running on http://0.0.0.0:${PORT}`);
});