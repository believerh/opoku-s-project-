// Emergency password reset for any account:  npm run reset-admin -- admin@example.com "NewPassword123"
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs'), mongoose = require('mongoose'), connect = require('../db');
const [email, pw] = process.argv.slice(2);
if (!email || !pw || pw.length < 10) { console.error('Usage: npm run reset-admin -- admin@example.com "NewPassword"  (min 10 characters)'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set.'); process.exit(1); }
(async () => {
  await connect(process.env);
  const r = await mongoose.connection.collection('users').updateOne({ email: email.trim().toLowerCase() },
    { $set: { passwordHash: bcrypt.hashSync(pw, 12), active: true }, $inc: { tokenVersion: 1 } });
  console.log(r.matchedCount ? 'Password updated. All old sessions for that account are signed out.' : 'No account with that email.');
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
