import { config } from 'dotenv';
config({ path: '.env.local' }); config();
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const camp = '912c9a7b-72cc-4a32-b1ca-82c70991a451';
const cs = await sql`select status, count(*) c from campaign_contacts where campaign_id=${camp} group by status order by status`;
console.log('CONTACT_STATUSES=' + cs.map((r:any)=>`${r.status}:${r.c}`).join(','));
const calls = await sql`select outcome, count(*) c from campaign_calls where campaign_id=${camp} group by outcome order by outcome`;
console.log('CALLS=' + calls.map((r:any)=>`${r.outcome}:${r.c}`).join(','));
const [cmp] = await sql`select status, completed_at is not null as done from campaigns where id=${camp}`;
console.log('CAMPAIGN_STATUS=' + cmp.status + ' completed_at_set=' + cmp.done);
// Verify the Drizzle insert path stores call_window as object (import real db code)
const { db } = await import('../lib/db/index.js');
const { campaigns } = await import('../lib/db/schema.js');
const [u] = await sql`select id from users limit 1`;
const [ins] = await (db as any).insert(campaigns).values({ userId: u.id, name: 'TYPECHECK insert' }).returning();
const [ty] = await sql`select jsonb_typeof(call_window) tw, jsonb_typeof(retry_rules) tr, jsonb_typeof(persona) tp from campaigns where id=${ins.id}`;
console.log('DRIZZLE_INSERT_TYPES call_window=' + ty.tw + ' retry_rules=' + ty.tr + ' persona=' + ty.tp);
await sql`delete from campaigns where id=${ins.id}`;
await sql`delete from campaigns where id=${camp}`; // cleanup test campaign
console.log('CLEANUP=done');
await sql.end();
