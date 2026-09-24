import { EventEmitter } from "node:events";

// Local server process owns HTTP routes and realtime connections.
export const accessRevocation = new EventEmitter();
accessRevocation.setMaxListeners(0);
