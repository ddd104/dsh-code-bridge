import {z} from 'zod';
import {uuid} from '../../shared/protocol.mjs';
const PACKAGE = 'dsh-code-bridge';
const codec = (label, schema) => ({mode:'strict', typeSymbol:`${PACKAGE}#${label}`, create:() => schema});
const agent = {name:'agent', wire:'agentId', source:'lookup', lookup:'agent', codec:{mode:'strict', typeSymbol:'@deepseek-ai/dsh-session/types#SessionId', create:() => z.string().min(1)}};
const schemas = {
  poll:z.object({clientId:uuid, label:z.string().min(1).max(300), projectPath:z.string().max(4096), activatedAt:z.number().finite().nonnegative().optional()}).strict(),
  ack:z.object({clientId:uuid, id:uuid, state:z.enum(['applied','rejected']), reason:z.string().max(300).optional()}).strict(),
  release:z.object({clientId:uuid, targetId:uuid}).strict()
};
const descriptors = Object.entries(schemas).map(([method, schema]) => ({
  id:`${PACKAGE}#codeBridge/${method}`, service:'codeBridge', namespace:'codeBridge', method,
  invocation:{kind:'direct'}, scope:{context:'agent', wire:'agentId'},
  parameters:[agent, {name:'request', wire:'request', source:'json', codec:codec(method+'Request', schema)}], result:codec('CodeBridgeResult', z.json())
}));
export const TYPERT = {package:PACKAGE, face:'host', schemas:[], invocations:descriptors, model:{services:[], events:[], objects:[]}};
export const TYPERT_REMOTE = {package:PACKAGE, descriptors};
export {schemas};
export default TYPERT_REMOTE;
