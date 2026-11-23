import {CodeBridge} from './server.mjs';
import {TYPERT, schemas} from './remote.mjs';
export const name = 'code-bridge';
export const inject = ['typert'];
export async function apply(ctx) {
  const bridge = new CodeBridge();
  try {await bridge.start();} catch (error) {await bridge.close(); throw error;}
  ctx.effect(() => () => bridge.close(), 'DSH code bridge');
  const remote = {ctx};
  for (const method of Object.keys(schemas)) remote[method] = (agent, request) => {
    if (!agent?.session?.id) throw new Error('An owning conversation is required');
    return bridge[method](agent.session.id, schemas[method].parse(request));
  };
  remote.typertRemote = Object.freeze({service:remote, serviceKey:'codeBridge', namespace:'codeBridge'});
  ctx.provide('codeBridge', remote);
  ctx.typert.register(TYPERT);
}
