'use strict';
const http = require('node:http');

function stripUntrustedProxyHeaders(headers) {
  const clean = { ...headers };
  delete clean['x-dojo-proxy'];
  delete clean['x-dojo-mount'];
  delete clean['x-dojo-origin-host'];
  delete clean['x-dojo-internal'];
  return clean;
}

// Reuse the same mount/redirect rules for /coach on the student gateway and
// /member on the dedicated coach origin. Browser URLs always stay same-origin.
function proxy(targetPort, { prefix = '' } = {}) {
  return (req, res) => {
    const internalToken = process.env.ARSLAN_INTERNAL_PROXY_TOKEN || '';
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() || req.headers.host || '';
    const forwardedProto = req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http');
    const headers = {
      ...stripUntrustedProxyHeaders(req.headers),
      host: `localhost:${targetPort}`,
      'x-dojo-proxy': '1',
      'x-dojo-mount': prefix,
      'x-dojo-origin-host': forwardedHost,
      'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
      'x-forwarded-proto': forwardedProto,
      ...(internalToken ? { 'x-dojo-internal': internalToken } : {})
    };
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
      timeout: 30000
    }, incoming => {
      const responseHeaders = { ...incoming.headers };
      const location = responseHeaders.location;
      if (prefix && location && location.startsWith('/') && !location.startsWith('//') &&
          location !== prefix && !location.startsWith(prefix + '/') && !location.startsWith(prefix + '?')) {
        responseHeaders.location = prefix + location;
      }
      res.writeHead(incoming.statusCode, responseHeaders);
      incoming.pipe(res);
    });
    outgoing.on('timeout', () => {
      outgoing.destroy(new Error('Upstream proxy timeout'));
    });
    outgoing.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway');
    });
    req.on('aborted', () => outgoing.destroy());
    req.pipe(outgoing);
  };
}

module.exports = { proxy, stripUntrustedProxyHeaders };
