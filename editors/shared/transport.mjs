import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {request as httpRequest} from 'node:http';
export const discoveryDirectory = () => process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'DSHCodeBridge', 'instances') : join(homedir(), '.dsh-code-bridge', 'instances');

export async function request(endpoint, path, body) {
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || !/^[a-f0-9]{64}$/.test(endpoint.token)) throw new Error('Invalid local DSH endpoint');
  // Explicit loopback HTTP avoids browser-backed fetch/proxy behavior in IDE hosts.
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({hostname:'127.0.0.1', port:endpoint.port, path, agent:false,
      method:payload === undefined ? 'GET' : 'POST',
      headers:{Authorization:`Bearer ${endpoint.token}`, 'Content-Type':'application/json', ...(payload === undefined ? {} : {'Content-Length':Buffer.byteLength(payload)})}
    }, response => {
      const chunks=[]; let size=0;
      response.on('data', chunk => {size += chunk.length; if(size > 512*1024) {req.destroy(new Error('DSH response too large')); return;} chunks.push(chunk);});
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode < 200 || response.statusCode >= 300) reject(new Error(value.error ?? `DSH HTTP ${response.statusCode}`));
          else resolve(value);
        } catch (error) {reject(error);}
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error('连接 DSH 超时')), 3500);
    req.on('close', () => clearTimeout(timeout)); req.on('error', reject);
    req.end(payload);
  });
}
export async function discoverTargets(directory = discoveryDirectory()) {
  let files; try {files = await readdir(directory);} catch (error) {if (error.code === 'ENOENT') return []; throw error;}
  const results = await Promise.allSettled(files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).slice(0, 64).map(async name => {
    const bytes = await readFile(join(directory, name)); if (bytes.length > 4096) return [];
    const endpoint = JSON.parse(bytes.toString('utf8'));
    if (endpoint.version !== 1 || endpoint.instanceId + '.json' !== name) return [];
    const result = await request(endpoint, '/v1/targets');
    if (result.version !== 1 || result.instanceId !== endpoint.instanceId || !Array.isArray(result.targets)) return [];
    return result.targets.map(target => ({...target, endpoint}));
  }));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
export function currentTarget(targets) {
  if (!targets.length) throw new Error('请先在 DSH 中打开一个对话，并确认 dsh-code-bridge 插件已启用。');
  return [...targets].sort((a, b) => (b.activatedAt ?? 0) - (a.activatedAt ?? 0) || a.id.localeCompare(b.id))[0];
}
export async function sendCapture(target, capture, {waitMs = 15000} = {}) {
  let status;
  try {status = await request(target.endpoint, '/v1/captures', {...capture, targetId:target.id});}
  catch (error) {
    // A timed-out POST may have been admitted. Reconcile the same ID before reporting failure.
    try {status = await request(target.endpoint, `/v1/captures/${capture.id}`);} catch {throw error;}
  }
  const deadline = Date.now() + waitMs;
  while (status.state === 'pending' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {status = await request(target.endpoint, `/v1/captures/${capture.id}`);} catch {return {state:'pending', reason:'已提交，暂时无法确认是否加入草稿；请检查目标 DSH 对话，避免重复添加。'};}
  }
  return status;
}
