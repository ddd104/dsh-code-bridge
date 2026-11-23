import {createServer} from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual, createHash} from 'node:crypto';
import {mkdir, writeFile, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {captureSchema, MAX_BODY, VERSION} from '../../shared/protocol.mjs';

export const discoveryDirectory = () => process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'DSHCodeBridge', 'instances') : join(homedir(), '.dsh-code-bridge', 'instances');
const fail = (status, message) => {throw Object.assign(new Error(message), {status});};
const key = (sessionId, clientId) => JSON.stringify([sessionId, clientId]);
const LEASE_MS = 12000;
const REQUEST_MS = 120000;

/** Local transport owns only explicit captures, never editor selection listeners or model calls. */
export class CodeBridge {
  constructor({directory = discoveryDirectory(), now = Date.now} = {}) {
    this.directory = directory; this.now = now;
    this.instanceId = randomUUID(); this.token = randomBytes(32).toString('hex');
    this.targets = new Map(); this.requests = new Map(); this.closed = false;
  }
  async start() {
    this.server = createServer((req, res) => {void this.handle(req, res);});
    this.server.requestTimeout = 10000; this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve);});
    this.port = this.server.address().port;
    await mkdir(this.directory, {recursive:true, mode:0o700});
    this.discoveryPath = join(this.directory, `${this.instanceId}.json`);
    await writeFile(this.discoveryPath, JSON.stringify({version:VERSION, instanceId:this.instanceId, port:this.port, token:this.token, pid:process.pid}), {mode:0o600, flag:'wx'});
    this.timer = setInterval(() => this.sweep(), 5000); this.timer.unref?.();
    return this;
  }
  sweep() {
    const now = this.now();
    for (const [id, target] of this.targets) if (now - target.seen > LEASE_MS) this.targets.delete(id);
    for (const [id, request] of this.requests) {
      if (request.state === 'pending' && now - request.created > REQUEST_MS) {
        request.state = 'expired'; request.reason = '接收超时；未加入草稿，请保持目标 DSH 对话打开后重试。'; delete request.capture;
      }
      if (now - request.created > 10 * 60 * 1000) this.requests.delete(id);
    }
  }
  poll(sessionId, {clientId, label, projectPath, activatedAt = 0}) {
    if (this.closed) fail(503, 'Bridge is closed');
    this.sweep();
    const identity = key(sessionId, clientId);
    let target = [...this.targets.values()].find(t => t.identity === identity);
    if (!target) {
      if (this.targets.size >= 64) fail(429, 'Too many DSH conversation windows');
      target = {id:randomUUID(), identity, sessionId, clientId, activatedAt:this.now()}; this.targets.set(target.id, target);
    }
    target.activatedAt = Math.max(target.activatedAt, Math.min(activatedAt, this.now()));
    Object.assign(target, {label, projectPath, seen:this.now()});
    const request = [...this.requests.values()].find(r => r.targetId === target.id && r.state === 'pending');
    return {targetId:target.id, request:request ? {id:request.id, capture:request.capture} : null};
  }
  ack(sessionId, {clientId, id, state, reason}) {
    this.sweep();
    const request = this.requests.get(id);
    if (!request || request.identity !== key(sessionId, clientId)) fail(404, 'Capture does not belong to this conversation window');
    if (request.state === 'pending') {request.state = state; request.reason = reason; delete request.capture;}
    return {state:request.state};
  }
  release(sessionId, {clientId, targetId}) {
    const target = this.targets.get(targetId);
    if (target?.identity === key(sessionId, clientId)) {
      this.targets.delete(targetId);
      for (const request of this.requests.values()) if (request.targetId === targetId && request.state === 'pending') {
        request.state = 'rejected'; request.reason = 'DSH 对话已关闭或切换，请在编辑器重新点击 ask for dsh。'; delete request.capture;
      }
    }
    return {};
  }
  listTargets() {
    this.sweep();
    return [...this.targets.values()].map(({id, label, projectPath, sessionId, activatedAt}) => ({id, label, projectPath, sessionId, activatedAt}));
  }
  accept(value) {
    const parsed = captureSchema.safeParse(value);
    if (!parsed.success) fail(400, 'Invalid code capture: ' + parsed.error.issues[0].message);
    this.sweep();
    const capture = parsed.data;
    const fingerprint = createHash('sha256').update(JSON.stringify(capture)).digest('hex');
    const previous = this.requests.get(capture.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail(409, 'Capture ID was already used for different content');
      return this.status(capture.id);
    }
    const target = this.targets.get(capture.targetId);
    if (!target) fail(409, 'DSH 对话已离线，请打开当前对话后重试。');
    if (this.requests.size >= 256 || [...this.requests.values()].filter(r => r.state === 'pending').length >= 32) fail(429, '接收队列已满，请稍后再试。');
    this.requests.set(capture.id, {id:capture.id, targetId:target.id, identity:target.identity, capture,
      fingerprint, state:'pending', created:this.now()});
    return this.status(capture.id);
  }
  status(id) {
    this.sweep(); const request = this.requests.get(id);
    if (!request) fail(404, 'Capture not found');
    return {id:request.id, state:request.state, ...(request.reason ? {reason:request.reason} : {})};
  }
  async handle(req, res) {
    const reply = (status, value) => {if (!res.destroyed) {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value));}};
    try {
      // Browser origins are never accepted; clients discover a per-process secret on the local filesystem.
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${this.port}`) fail(403, 'Local editor clients only');
      const supplied = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${this.token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(401, 'Authentication required');
      if (req.method === 'GET' && req.url === '/v1/targets') return reply(200, {version:VERSION, instanceId:this.instanceId, targets:this.listTargets()});
      if (req.method === 'GET' && /^\/v1\/captures\/[a-f0-9-]{36}$/.test(req.url)) return reply(200, this.status(req.url.split('/').at(-1)));
      if (req.method !== 'POST' || req.url !== '/v1/captures') fail(404, 'Unknown endpoint');
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) fail(415, 'JSON required');
      const chunks = []; let size = 0;
      for await (const chunk of req) {size += chunk.length; if (size > MAX_BODY) fail(413, '选中代码过大，请缩小选区。'); chunks.push(chunk);}
      let value; try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail(400, 'Invalid JSON');}
      reply(202, this.accept(value));
    } catch (error) {reply(error.status ?? 500, {error:error.status ? error.message : 'Code bridge failed'});}
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    if (this.discoveryPath) await unlink(this.discoveryPath).catch(error => {if (error.code !== 'ENOENT') throw error;});
    if (this.server?.listening) {this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve));}
    this.targets.clear(); this.requests.clear();
  }
}
