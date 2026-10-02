const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('./server/config');
const token = jwt.sign({ id: '6ab91cf538b86a0159241fff', username: 'mamangharun' }, config.JWT_SECRET, { expiresIn: '1d' });
axios.post('http://127.0.0.1:3050/api/sys/tiktok/test-connect', { tiktokUsername: 'gamingtools.fun' }, { headers: { Authorization: 'Bearer ' + token }})
.then(res => console.log('Connected!'))
.catch(err => console.log('Err:', err.response?.data || err.message));
