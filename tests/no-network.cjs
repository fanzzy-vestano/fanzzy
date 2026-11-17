// Used only as a preload for isolated tests. Every external service must be mocked.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload patches Node's built-in transports before tests import them. */
const blocked = () => { throw new Error("Network access is disabled for isolated tests"); };
globalThis.fetch = blocked;
for (const name of ["node:http", "node:https"]) {
  const transport = require(name);
  transport.request = blocked;
  transport.get = blocked;
}
const net = require("node:net");
net.connect = blocked;
net.createConnection = blocked;
