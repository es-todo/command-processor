import express from "express";
import body_parser from "body-parser";

const port = 3000;
const app = express();
app.use(body_parser.json());

app.get("/", async (_req, res) => {
  try {
    res.send(`Hello World! Time is ${new Date().toISOString()}`);
  } catch (err) {
    res.json(err);
  }
});

app.listen(port, () => {
  console.log(`command processor listening on port ${port}`);
});
