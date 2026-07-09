const express = require('express');

const { listVehicleTypes, listMaterialTypes, listCities, getDistance } = require('../controllers/config.controller');

const router = express.Router();

router.get('/config/vehicle-types', listVehicleTypes);
router.get('/config/material-types', listMaterialTypes);
router.get('/config/cities', listCities);
router.post('/config/distance', getDistance);

module.exports = router;
