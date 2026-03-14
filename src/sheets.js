/**
 * 구글시트 연동 모듈
 */

const axios = require('axios');

const sheetEnabled = !!process.env.GOOGLE_API_URL;

const getRows = (q) =>
  sheetEnabled
    ? axios.get(`${process.env.GOOGLE_API_URL}?q=${encodeURIComponent(q)}`).then((r) => r.data)
    : Promise.resolve([]);

const addRow = (d) =>
  sheetEnabled
    ? axios.post(process.env.GOOGLE_API_URL, d)
    : Promise.resolve();

const updateRow = (d) =>
  sheetEnabled
    ? axios.post(process.env.GOOGLE_API_URL, { ...d, _action: 'update' })
    : Promise.resolve();

const deleteRow = (id) =>
  sheetEnabled
    ? axios.post(process.env.GOOGLE_API_URL, { _action: 'delete', id })
    : Promise.resolve();

module.exports = { sheetEnabled, getRows, addRow, updateRow, deleteRow };
