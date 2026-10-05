// Tests run against an in-memory embedded Postgres and never touch the dev database or any AI provider.
process.env.PGLITE_DIR = ":memory:";
process.env.LIFEOS_AUTO_SEED = "false";
process.env.LOG_LEVEL = "error";
process.env.STORAGE_DIR = `${process.cwd()}/.data/test-uploads`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_COMPAT_BASE_URL;
delete process.env.DATABASE_URL;
delete process.env.EMBEDDINGS_PROVIDER;
