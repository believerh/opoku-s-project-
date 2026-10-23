// Generates the key pair for push notifications. Put the two values in VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
const k = require('web-push').generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('\nKeep the private key secret. If you change these keys later, everyone must re-enable notifications.');
