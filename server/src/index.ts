import { createApp } from "./app.js";

const port = process.env.PORT || 9091;
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
