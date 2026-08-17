import { createApp } from "./app.js";
import { config } from "./config.js";
import { retryDueDeliveries } from "./subscriptions.js";

const app = createApp();
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Automation Hub listening on ${config.port}`);
});
const deliveryTimer = setInterval(() => void retryDueDeliveries().catch((error) => console.error("Webhook retry failed", error)), 30_000);
deliveryTimer.unref();

function shutdown() {
  clearInterval(deliveryTimer);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
