import { createApp } from "./app.js";

const port = process.env.PORT || 9090;
const host = process.env.HOST?.trim() || "0.0.0.0";
const app = createApp();

const server = app.listen(Number(port), host, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  console.log(`Server listening at http://${host}:${listeningPort}/`);
});
