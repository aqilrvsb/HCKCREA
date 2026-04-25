import pg from "pg";
import { readFileSync } from "fs";

const sql = readFileSync(process.argv[2], "utf8");

// Try multiple connection candidates: direct + pooler (transaction & session)
const candidates = [
  {
    name: "direct",
    cfg: {
      host: "db.zoxgcqlqovkvlrmpcikt.supabase.co",
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: "Dev2025@@ASD",
      ssl: { rejectUnauthorized: false },
    },
  },
  // Common Supabase regions for AP — try APAC first since user is Malaysian
  {
    name: "pooler-ap-southeast-1-session",
    cfg: {
      host: "aws-0-ap-southeast-1.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      user: "postgres.zoxgcqlqovkvlrmpcikt",
      password: "Dev2025@@ASD",
      ssl: { rejectUnauthorized: false },
    },
  },
  {
    name: "pooler-ap-southeast-1-tx",
    cfg: {
      host: "aws-0-ap-southeast-1.pooler.supabase.com",
      port: 6543,
      database: "postgres",
      user: "postgres.zoxgcqlqovkvlrmpcikt",
      password: "Dev2025@@ASD",
      ssl: { rejectUnauthorized: false },
    },
  },
  {
    name: "pooler-ap-southeast-2-session",
    cfg: {
      host: "aws-0-ap-southeast-2.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      user: "postgres.zoxgcqlqovkvlrmpcikt",
      password: "Dev2025@@ASD",
      ssl: { rejectUnauthorized: false },
    },
  },
  {
    name: "pooler-us-east-1-session",
    cfg: {
      host: "aws-0-us-east-1.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      user: "postgres.zoxgcqlqovkvlrmpcikt",
      password: "Dev2025@@ASD",
      ssl: { rejectUnauthorized: false },
    },
  },
];

let lastErr = null;
for (const c of candidates) {
  const client = new pg.Client({ ...c.cfg, connectionTimeoutMillis: 8000 });
  try {
    process.stdout.write(`Trying ${c.name}... `);
    await client.connect();
    console.log("connected.");
    await client.query(sql);
    console.log("✓ Migration applied successfully via", c.name);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log("failed:", e.message);
    lastErr = e;
    try {
      await client.end();
    } catch {}
  }
}

console.error("\n✗ All candidates failed. Last error:", lastErr?.message);
process.exit(1);
