require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  user: process.env.DB_USER || "tigerex",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "tigerex",
  password: process.env.DB_PASSWORD || "tigerex",
  port: process.env.DB_PORT || 5432,
});

async function migrate() {
  try {
    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL for migration");

    const schemaPath = path.join(__dirname, "../../TigerEx/database_schema/complete_schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    await client.query(schema);
    console.log("✅ PostgreSQL schema migrated successfully");

    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL migration failed:", error);
    process.exit(1);
  }
}

module.exports = migrate;
