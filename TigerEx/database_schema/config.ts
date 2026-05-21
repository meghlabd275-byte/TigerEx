// Database Configuration
// PostgreSQL + Redis setup

module.exports = {
  postgres: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB || 'tigerex',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,
    pool: { max: 20, min: 5 },
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
  timeseries: {
    host: process.env.TSDB_HOST || 'localhost',
    port: 8086,
  },
};