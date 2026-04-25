import pg from "pg";
import { readFileSync } from "fs";

const sql = readFileSync(process.argv[2], "utf8");
const client = new pg.Client({
  host: "db.zoxgcqlqovkvlrmpcikt.supabase.co",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "Dev20225@@ASD",
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(sql);
  console.log("✓ Migration applied successfully");
} catch (e) {
  console.error("✗ Error:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
