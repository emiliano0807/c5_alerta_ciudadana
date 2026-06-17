const express = require('express');
const router = express.Router();
const recepcionController = require('../controllers/recepcion.controller');

router.get('/', recepcionController.getStatus);
router.post('/', recepcionController.processHttpAlert);

module.exports = router;