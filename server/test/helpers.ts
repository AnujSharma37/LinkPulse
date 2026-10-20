import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const app = createApp();

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(() => {});
}

let n = 0;
/** Sign up a fresh user and return a supertest agent that keeps its session cookie. */
export async function newUser(email = `user${Date.now()}_${n++}@example.com`) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({ email, password: 'secret123', displayName: 'Tester' });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user, email };
}

export async function createLink(agent: ReturnType<typeof request.agent>, body: Record<string, unknown>) {
  return agent.post('/api/links').send(body);
}
