import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {sessionCodec} from './hosted-storage.js';
import {validateLibrary} from './storage.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const unavailable = () => Object.assign(new Error('The preview database is temporarily unavailable.'),{status:503});

export function neonStorage(connectionString,secret,connect=neon) {
  const sql = connect(connectionString);
  const codec = sessionCodec(secret);
  let ready;

  function initialize() {
    // Serialize initial schema setup across concurrent serverless cold starts.
    ready ||= sql.transaction([
      sql`SELECT pg_advisory_xact_lock(14001253)`,
      sql`CREATE TABLE IF NOT EXISTS tada_libraries (
        key TEXT PRIMARY KEY, revision BIGINT NOT NULL, data JSONB NOT NULL, updated_at TEXT NOT NULL
      )`,
      sql`CREATE TABLE IF NOT EXISTS tada_sessions (
        key TEXT PRIMARY KEY, encrypted TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
      )`,
      sql`CREATE INDEX IF NOT EXISTS tada_sessions_expiry ON tada_sessions(expires_at)`
    ]).catch(() => {
      ready = undefined;
      throw unavailable();
    });
    return ready;
  }

  async function query(strings,...values) {
    await initialize();
    try {
      return await sql(strings,...values);
    } catch {
      throw unavailable();
    }
  }

  return {
    library: {
      async read(id) {
        const [row] = await query`SELECT revision, data, updated_at FROM tada_libraries WHERE key = ${hash(id)}`;
        return row ? {revision:Number(row.revision),data:row.data,updatedAt:row.updated_at} :
          {revision:0,data:null,updatedAt:null};
      },
      async write(id,expectedRevision,value,validate=validateLibrary) {
        if(!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER) {
          throw Object.assign(new Error('Invalid library revision.'),{status:400});
        }
        const key = hash(id);
        const data = JSON.stringify(validate(value));
        const revision = expectedRevision + 1;
        const updatedAt = new Date().toISOString();
        const rows = expectedRevision === 0
          ? await query`INSERT INTO tada_libraries(key,revision,data,updated_at)
              VALUES (${key},${revision},${data}::jsonb,${updatedAt}) ON CONFLICT (key) DO NOTHING RETURNING revision`
          : await query`UPDATE tada_libraries SET revision = ${revision}, data = ${data}::jsonb, updated_at = ${updatedAt}
              WHERE key = ${key} AND revision = ${expectedRevision} RETURNING revision`;
        if(!rows.length) throw Object.assign(new Error('This library was changed in another tab. Reload from the database before saving again.'),{status:409});
        return {revision,updatedAt};
      }
    },
    sessions: {
      async get(id) {
        if(!id) return;
        const [row] = await query`SELECT encrypted FROM tada_sessions WHERE key = ${hash(id)} AND expires_at > now()`;
        return row ? codec.open(row.encrypted) : undefined;
      },
      async set(id,value) {
        const key = hash(id);
        await query`WITH expired AS (
          DELETE FROM tada_sessions WHERE expires_at <= now() AND key <> ${key}
        ) INSERT INTO tada_sessions(key,encrypted,expires_at)
          VALUES (${key},${codec.seal(value)},${new Date(value.expires).toISOString()}::timestamptz)
          ON CONFLICT (key) DO UPDATE SET encrypted = EXCLUDED.encrypted, expires_at = EXCLUDED.expires_at`;
      },
      async delete(id) {
        if(id) await query`DELETE FROM tada_sessions WHERE key = ${hash(id)}`;
      }
    }
  };
}
