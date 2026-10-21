import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

// Fail closed: tests must inject service doubles rather than contact live APIs.
const blocked = () => { throw new Error("Network access is disabled for unit tests"); };
globalThis.fetch = blocked;
for (const network of [http, https]) {
  network.request = blocked;
  network.get = blocked;
}
net.connect = blocked;
net.createConnection = blocked;
syncBuiltinESMExports();
