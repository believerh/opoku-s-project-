const mongoose = require('mongoose'), dns = require('dns');
// Connects to MongoDB. If the connection string names no database (e.g. Railway's MONGO_URL),
// MONGODB_DB or "okomfo_anokye" is used.
module.exports = function connect(E) {
  // Some systems (notably Termux on Android) give Node no working DNS settings, so Atlas "mongodb+srv://"
  // addresses fail with "querySrv/queryTxt ETIMEOUT". Use public DNS there, or whatever DNS_SERVERS says.
  const custom = (E.DNS_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const termux = !!(E.PREFIX && E.PREFIX.includes('com.termux'));
  try { if (custom.length) dns.setServers(custom); else if (termux) dns.setServers(['8.8.8.8', '1.1.1.1']); }
  catch (e) { console.warn('Could not set DNS servers: ' + e.message); }
  const hasDb = /^mongodb(?:\+srv)?:\/\/[^/]+\/[^?\s]+/.test(E.MONGODB_URI);
  return mongoose.connect(E.MONGODB_URI, { serverSelectionTimeoutMS: 10000, ...(E.MONGODB_DB || !hasDb ? { dbName: E.MONGODB_DB || 'okomfo_anokye' } : {}) });
};
