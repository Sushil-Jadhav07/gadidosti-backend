const { body } = require('express-validator');

const createTruckValidation = [];
const updateTruckValidation = [];
const createDriverValidation = [];
const updateDriverValidation = [];

const updateDriverLocationValidation = [
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
];

module.exports = {
  createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation,
  updateDriverLocationValidation,
};
