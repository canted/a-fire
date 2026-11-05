CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  docable_type TEXT NOT NULL,
  docable_id INTEGER NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS index_documents_on_docable_type_and_docable_id
ON documents (docable_type, docable_id);
