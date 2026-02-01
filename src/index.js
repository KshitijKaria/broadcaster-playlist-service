import { createApp } from "./app.js";

const port = process.env.PORT || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});
