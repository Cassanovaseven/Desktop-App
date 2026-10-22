// Tiruan sidecar untuk tes: aturan env dan token sama dengan sidecar Python.
import http from 'node:http'

const token = process.env.ALFONSO_SIDECAR_TOKEN
const port = Number(process.env.ALFONSO_SIDECAR_PORT)
if (!token || !port) process.exit(2)
if (process.env.FAKE_CRASH === '1') process.exit(1)

http
  .createServer((req, res) => {
    if (req.headers['x-alfonso-token'] !== token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'token tidak valid' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }))
  })
  .listen(port, '127.0.0.1')
