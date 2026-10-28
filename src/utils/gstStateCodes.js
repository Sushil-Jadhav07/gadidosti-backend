// Official GST state codes — the first two digits of any GSTIN. Used to decide CGST+SGST
// (company and client in the same state) vs IGST (different states) on the platform fee's GST
// breakdown. Source: CBIC's own state code list (unchanged since GST rollout).
const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

const GSTIN_REGEX = /^\d{2}[A-Z0-9]{13}$/i;

const getGstStateCode = (gstin) => {
  if (!gstin || !GSTIN_REGEX.test(gstin.trim())) return null;
  return gstin.trim().slice(0, 2);
};

const getGstStateName = (gstin) => {
  const code = getGstStateCode(gstin);
  return code ? GST_STATE_CODES[code] || null : null;
};

module.exports = { GST_STATE_CODES, getGstStateCode, getGstStateName };
