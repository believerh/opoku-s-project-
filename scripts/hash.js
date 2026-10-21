const bcrypt = require('bcryptjs');
const p = process.argv[2];
if (!p || p.length < 10) { console.error('Usage: npm run hash -- "your-strong-password"  (at least 10 characters)'); process.exit(1); }
console.log(bcrypt.hashSync(p, 12));
