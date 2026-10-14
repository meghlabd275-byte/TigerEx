require("dotenv").config();
const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  const production = process.env.NODE_ENV === "production";
  const common = {
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    application_name: "tigerex-migrations",
    ...(production ? { ssl: { rejectUnauthorized: true } } : {}),
  };

  if (connectionString) {
    return new Pool({ connectionString, ...common });
  }

  return new Pool({
    host: requiredEnv("DB_HOST"),
    port: Number(process.env.DB_PORT || 5432),
    database: requiredEnv("DB_NAME"),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    ...common,
  });
}

async function migrate() {
  const schemaPath = path.resolve(
    __dirname,
    "../../TigerEx/database_schema/complete_schema.sql"
  );
  const pool = createPool();
  let client;

  try {
    const schema = fs.readFileSync(schemaPath, "utf8");
    if (!schema.trim()) {
      throw new Error(`Migration schema is empty: ${schemaPath}`);
    }

    client = await pool.connect();
    await client.query("SELECT 1");
    await client.query("BEGIN");
    await client.query(schema);
    await client.query("COMMIT");
    console.log("Database migration completed successfully.");
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Migration rollback failed.");
      }
    }
    // Do not log connection strings, credentials, SQL parameters, or raw errors
    // that may contain secrets.
    console.error("Database migration failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
