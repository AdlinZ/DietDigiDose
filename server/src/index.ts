import { createApp } from "./app.js";
import { startNotificationScheduler } from "./services/notifications.js";

const port = process.env.PORT || 9090;
const host = process.env.HOST?.trim() || "0.0.0.0";
const app = createApp();
startNotificationScheduler();

app.listen(Number(port), host, () => {
  console.log(`Server listening at http://${host}:${port}/`);
});
