import { treaty } from "@elysiajs/eden";
import type { App } from "../../../server/src/app";

// Import the Elysia app only as a type: the browser bundle must not include server code.
export const api = treaty<App>(window.location.origin);
