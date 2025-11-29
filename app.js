// Lightweight alias so `node app.js` works like `node server.js`.
// This file simply loads the real server implementation in server.js
// and ensures people who run `node app.js` (mistakenly) still start the server.

require('./server.js');
