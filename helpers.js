'use strict';
require('dotenv').config();
const axios = require('axios');
const xml2js = require('xml2js');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });

const BASE_URL = `https://${process.env.ENTERVO_HOST}:${process.env.ENTERVO_PORT}`;
const AUTH = {
    username : process.env.ENTERVO_USER,
    password : process.env.ENTERVO_PASSWORD
};

const CASHIER = {
    computer_id  : process.env.CASHIER_COMPUTER_ID,
    device_id    : process.env.CASHIER_DEVICE_ID,
    contract_id  : process.env.CASHIER_CONTRACT_ID,
    consumer_id  : process.env.CASHIER_CONSUMER_ID,
    password     : process.env.CASHIER_PASSWORD
};

const builder = new xml2js.Builder({ headless : true });

// Cola de pagos
let _queue = [];
let _processing = false;

const _processQueue = async function () {
    if (_processing || _queue.length === 0) return;
    _processing = true;

    let { params, resolve, reject } = _queue.shift();

    try {
        let result = await _doCheckout(params);
        resolve(result);
    } catch (err) {
        reject(err);
    } finally {
        _processing = false;
        _processQueue();
    }
};

module.exports = function () {
    let _self = this;

    _self.get = async function (url, params) {
        try {
            let queryString = params ? Object.keys(params)
                .map(key => `${key}=${params[key]}`)
                .join('&') : '';

            let fullUrl = queryString ? `${BASE_URL}${url}?${queryString}` : `${BASE_URL}${url}`;
            console.log('GET Full URL:', fullUrl);
            console.log('GET Auth:', AUTH);

            let result = await axios.get(fullUrl, {
                auth       : AUTH,
                httpsAgent : agent,
                headers    : { accept : '*/*' }
            });
            console.log('Response data:', JSON.stringify(result.data));

            if (typeof result.data === 'string') {
                let parsed = await xml2js.parseStringPromise(result.data, { explicitArray : false });
                console.log('Parsed data:', JSON.stringify(parsed));
                return parsed;
            }

            return result.data;
        } catch (err) {
            console.log('GET Error status:', err.response ? err.response.status : 'no response');
            console.log('GET Error headers:', err.response ? err.response.headers : 'no headers');
            let message = err.response ? `Entervo error ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
            throw new Error(message);
        }
    };
    _self.post = async function (url, data) {
        let result = await axios.post(`${BASE_URL}${url}`, data, {
            auth       : AUTH,
            httpsAgent : agent,
            headers    : { accept : 'application/json' }
        });
        return result.data;
    };

    _self.put = async function (url, xml) {
        try {
            let result = await axios.put(`${BASE_URL}${url}`, xml, {
                auth       : AUTH,
                httpsAgent : agent,
                headers    : {
                    'Content-Type' : 'text/xml',
                    'accept'       : '*/*'
                }
            });
            console.log('PUT response:', JSON.stringify(result.data));
            return result.data;
        } catch (err) {
            console.log('PUT error status:', err.response ? err.response.status : 'no response');
            console.log('PUT error data:', err.response ? JSON.stringify(err.response.data) : err.message);
            let message = err.response ? `PUT error ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
            throw new Error(message);
        }
    };

    _self.balance = async function (params) {
        let rid = Math.floor(Date.now() / 1000);
        let ticket = null;

        if (params.barcode) {
            let response = await _self.get(`/TicketClassificationWebService/ticket-classification`, {
                requestid : rid,
                barcode   : params.barcode,
                type      : '128B'
            });
        
            let classification = response.classification;
        
            if (classification.responsecode === '0' && classification.ticketdata) {
                ticket = classification.ticketdata;
            
                let extResponse = await _self.get(`/TicketClassificationWebService/ext-medium-ticket-classification`, {
                    requestid : rid,
                    epan      : classification.ticketdata.epan
                });
            
                let extData = extResponse.classificationextmedium;
                if (extData.responsecode === '0' && extData.ticketdataextmedium) {
                    ticket = extData.ticketdataextmedium;
                }
            }
        } else if (params.plate) {
            let classification = await _self.get(`/TicketClassificationWebService/ext-medium-ticket-classification`, {
                requestid    : rid,
                licenseplate : params.plate
            });

            if (classification.responsecode === '0' && classification.ticketdataextmedium) {
                ticket = classification.ticketdataextmedium;
            }
        }

        if (!ticket) {
            throw new Error('Ticket not found');
        }

        let calculation = await _self.post(`/TicketClassificationWebService/ext-ticket-calculation?requestid=${rid}`, {
            operator      : ticket.operator,
            type          : ticket.type,
            subtype       : ticket.subtype,
            class         : ticket.class,
            entryfacility : ticket.entryfacility,
            entrytime     : ticket.entrytime,
            cell          : ticket.cell,
            device        : ticket.device,
            epan          : ticket.epan
        });

        return {
            code     : ticket.epan,
            amount   : calculation.amount,
            duration : calculation.duration,
            dates    : {
                entry    : ticket.entrytime,
                tariff   : calculation.tarifftime
            },
            flags    : {
                paid    : parseInt(ticket.countofpayments) > 0,
                present : ticket.presentinfacility === ticket.entryfacility
            },
            meta     : {
                ticket      : ticket,
                calculation : calculation
            }
        };
    };

    _self.shift = async function () {
        let response = await _self.get(`/PaymentWebService/cashiers/${CASHIER.contract_id},${CASHIER.consumer_id}/shifts`, {
            shiftStatus : 1
        });

        let data = response.shifts;

        if (data && data.shift) {
            let shift = data.shift;
            if (Array.isArray(shift)) {
                shift = shift.find(s => s.shiftStatus === '1');
            }
            if (shift && shift.shiftStatus === '1') {
                console.log('Shift found:', shift.shiftId, 'lastTransactionId:', shift.lastSalesTransactionId);
                return shift;
            }
        }

        return await _self.openShift();
    };

    _self.openShift = async function () {
        let now = new Date().toISOString().split('.')[0];
          console.log('Opening shift with:', CASHIER);
          console.log('Opening shift with:', CASHIER);
          console.log('ENTERVO_USER:', process.env.ENTERVO_USER);
          console.log('ENTERVO_PASSWORD:', process.env.ENTERVO_PASSWORD);
        let xml = builder.buildObject({
            'pay:shift' : {
                $                       : { 'xmlns:pay' : 'http://gsph.sub.com/payment/types' },
                'pay:computerId'        : CASHIER.computer_id,
                'pay:deviceId'          : CASHIER.device_id,
                'pay:cashierContractId' : CASHIER.contract_id,
                'pay:cashierConsumerId' : CASHIER.consumer_id,
                'pay:shiftNo'           : 1,
                'pay:createDateTime'    : now
            }
        });
        console.log('Shift XML:', xml);

        let result = await axios.post(`${BASE_URL}/PaymentWebService/shifts`, xml, {
            auth       : { username: process.env.ENTERVO_USER, password: process.env.ENTERVO_PASSWORD },
            httpsAgent : agent,
            headers    : { 'Content-Type' : 'text/xml', accept : '*/*' }
        });

        return result.data.shift || result.data;
    };

    // Cola de pagos — procesa uno a la vez
    let _queue = [];
    let _processing = false;
    
    const _processQueue = async function () {
        if (_processing || _queue.length === 0) return;
        _processing = true;
    
        let { params, resolve, reject } = _queue.shift();
    
        try {
            let result = await _doCheckout(params);
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            _processing = false;
            _processQueue();
        }
    };
    
    const _doCheckout = async function (params) {
        let balance = await _self.balance(params);
        let intentos = 0;
        const MAX_INTENTOS = 3;
    
        const convertDate = function (dateStr) {
            if (!dateStr || dateStr.length !== 14) return null;
            return `${dateStr.substr(0,4)}-${dateStr.substr(4,2)}-${dateStr.substr(6,2)}T${dateStr.substr(8,2)}:${dateStr.substr(10,2)}:${dateStr.substr(12,2)}`;
        };
    
        while (intentos < MAX_INTENTOS) {
            try {
                let shift = await _self.shift();
                let nextId = parseInt(shift.lastSalesTransactionId) + 1;
                let now = new Date().toISOString().split('.')[0];
            
                let xml = builder.buildObject({
                    'pay:salesTransactionDetail' : {
                        $                      : { 'xmlns:pay' : 'http://gsph.sub.com/payment/types' },
                        'pay:salesTransaction' : {
                            'pay:shiftId'                  : shift.shiftId,
                            'pay:computerId'               : CASHIER.computer_id,
                            'pay:deviceId'                 : CASHIER.device_id,
                            'pay:cashierContractId'        : CASHIER.contract_id,
                            'pay:cashierConsumerId'        : CASHIER.consumer_id,
                            'pay:salesTransactionID'       : nextId,
                            'pay:salesTransactionDateTime' : now,
                        },
                        'pay:articles' : {
                            'pay:article' : {
                                'pay:artClassRef'       : 0,
                                'pay:articleRef'        : 10100,
                                'pay:quantity'          : 1,
                                'pay:quantityExp'       : 0,
                                'pay:amount'            : params.amount || balance.amount,
                                'pay:vat'               : 0,
                                'pay:influenceRevenue'  : 1,
                                'pay:influenceCashFlow' : 1,
                                'pay:cardInfos'         : {
                                    'pay:cardInfo' : {
                                        'pay:transType'               : 42,
                                        'pay:transMark'               : 9,
                                        'pay:facility'                : balance.meta.ticket.entryfacility,
                                        'pay:epan'                    : balance.code,
                                        'pay:cardType'                : 1,
                                        'pay:cardSubType'             : 0,
                                        'pay:cardClass'               : 0,
                                        'pay:tariffTimeStart'         : convertDate(balance.dates.entry),
                                        'pay:tariffTimeEnd'           : balance.dates.tariff ? balance.dates.tariff.replace(' ', 'T') : now,
                                        'pay:moneyValue'              : params.amount || balance.amount,
                                        'pay:pointValue'              : 0,
                                        'pay:timeValue'               : 0,
                                        'pay:paymentCounter'          : 1,
                                        'pay:wkDayProgRef'            : 0,
                                        'pay:meetingNumber'           : 0,
                                        'pay:recodeTicketByTransType' : 1,
                                    }
                                }
                            }
                        }
                    }
                });
            
                let payment = await _self.put(`/PaymentWebService/shifts/${shift.shiftId}/salestransactions`, xml);
                let transaction = await _self.get(`/PaymentWebService/shifts/${shift.shiftId}/salestransactions/${nextId}`);
            
                return { transaction, payment };
            
            } catch (err) {
                intentos++;
                console.log(`Intento ${intentos} fallido:`, err.message);
            
                if (err.message.includes('30003') || err.message.includes('Wrong shift')) {
                    console.log('Wrong shift — cerrando y abriendo nuevo turno...');
                    try {
                        let shift = await _self.shift();
                        await _self.closeShift(shift);
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 500));
                
                } else if (err.message.includes('10003') || err.message.includes('Wrong Sequence')) {
                    console.log('Wrong sequence — reintentando...');
                    await new Promise(r => setTimeout(r, 500));
                
                } else {
                    throw err;
                }
            }
        }
        throw new Error('No se pudo completar el pago después de ' + MAX_INTENTOS + ' intentos');
    };
    
    _self.checkout = async function (params) {
        return new Promise((resolve, reject) => {
            console.log(`Pago en cola. Posición: ${_queue.length + 1}`);
            _queue.push({ params, resolve, reject });
            _processQueue();
        });
    }; 

    _self.stats = async function () {
        let version = await _self.get('/PaymentWebService/version');
        return {
            host    : process.env.ENTERVO_HOST,
            state   : 'online',
            version : version
        };
    };
};