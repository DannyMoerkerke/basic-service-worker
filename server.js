import express from 'express';
import https from 'https';
import fs from 'fs';

const app = express();
const port = 3000;

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

app.post('/post', async (req, res) => {
  res.send('POST request')
});

const server = https.createServer({
    key: fs.readFileSync('ssl/private-key.pem'),
    cert: fs.readFileSync('ssl/localhost-cert.pem')
  },
  app
);

server.listen(port, '0.0.0.0', () => {
  console.log(`Server for POST requests started at port ${port}`);
});
