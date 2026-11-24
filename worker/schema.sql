-- D1 schema for the Railcert library agent (railcert-ask).
-- Built by tools/rag/build_index.py, read by worker/src. Keep both in sync with worker/CONTRACT.md.

DROP TABLE IF EXISTS chunks_fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS docs;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS standards;
DROP TABLE IF EXISTS aliases;
DROP TABLE IF EXISTS trv;
DROP TABLE IF EXISTS meta;

-- One row per library file in catalogue.tsv that has text.
CREATE TABLE docs (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,   -- "<folder>/<filename>", as in catalogue.tsv and references_edges.csv
  folder       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  title        TEXT,
  reference    TEXT,                   -- e.g. "Implementing Regulation (EU) 2023/1695"
  short_name   TEXT,                   -- e.g. "CCS TSI"
  date_status  TEXT,                   -- raw catalogue value
  status       TEXT NOT NULL,          -- 'in_force' | 'consolidated' | 'repealed' | 'historical' | 'draft' | 'unknown'
  area         TEXT NOT NULL,          -- top folder without number, e.g. 'TSI', 'Norway', 'ERTMS_Specifications'
  ertms_set    TEXT,                   -- 'Set1'..'Set4', 'informative' or NULL
  lang         TEXT,                   -- 'en' | 'no' | other ISO code | NULL
  url          TEXT,                   -- official source
  notes        TEXT,
  n_pages      INTEGER,                -- NULL for HTML
  r2_key       TEXT,                   -- object key of the original file in R2 (= path), NULL if not uploaded
  duplicate_of TEXT                    -- path of the canonical copy if this file is a byte-identical duplicate
);
CREATE INDEX docs_area ON docs(area);
CREATE INDEX docs_short ON docs(short_name);

-- Structure-aware text chunks (~300-900 tokens each).
CREATE TABLE chunks (
  id          INTEGER PRIMARY KEY,     -- stable within one build; cited by the agent as [c:<id>]
  doc_id      INTEGER NOT NULL REFERENCES docs(id),
  ord         INTEGER NOT NULL,        -- order within the document
  heading     TEXT,                    -- heading path, e.g. "Annex I > 2. Risk assessment"
  locator     TEXT,                    -- citable unit: "Art. 15(8)", "§3.5.3.7", "TRV-07113", "Annex II" ...
  inner_file  TEXT,                    -- file inside a .zip, else NULL
  page_start  INTEGER,                 -- 1-based PDF page (of inner_file for zips), NULL for HTML
  page_end    INTEGER,
  anchor      TEXT,                    -- HTML fragment id (TRV-07113, Lovdata §), NULL for PDFs
  text        TEXT NOT NULL,
  tokens      INTEGER
);
CREATE INDEX chunks_doc ON chunks(doc_id, ord);

-- Keyword index. Contentless-external FTS5 over chunks.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, heading, locator,
  content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2 tokenchars ''./-'''
);

-- Citation graph, straight from 99_Reference_Map/references_edges.csv.
CREATE TABLE edges (
  citing_path      TEXT NOT NULL,
  cited_id         TEXT NOT NULL,
  cited_type       TEXT,
  cited_label      TEXT,
  cited_short_name TEXT,
  cited_title      TEXT,
  mentions         INTEGER,
  versions_cited   TEXT,
  cited_path       TEXT              -- library path if the cited item is in the library
);
CREATE INDEX edges_citing ON edges(citing_path);
CREATE INDEX edges_cited ON edges(cited_path);
CREATE INDEX edges_cited_id ON edges(cited_id);

-- 99_Reference_Map/standards_register.csv
CREATE TABLE standards (
  standard          TEXT PRIMARY KEY,  -- "EN 50126-1"
  title             TEXT,
  type              TEXT,
  availability      TEXT,
  link              TEXT,
  versions_cited    TEXT,
  cited_by_n_docs   INTEGER,
  citing_documents  TEXT,              -- '; '-separated library paths as in the CSV
  file_in_library   TEXT
);

-- Lower-cased alias -> doc path (short names, references, CELEX/FOR ids, "2023/1695" style numbers).
CREATE TABLE aliases (
  alias TEXT NOT NULL,
  path  TEXT NOT NULL,
  kind  TEXT                           -- 'short' | 'reference' | 'number' | 'celex' | 'lovdata'
);
CREATE INDEX aliases_alias ON aliases(alias);

-- tools/data/banenor_trv_requirements.tsv
CREATE TABLE trv (
  req_id  TEXT PRIMARY KEY,            -- "TRV:07113"
  path    TEXT NOT NULL,               -- library path of the HTML page
  anchor  TEXT,                        -- "TRV-07113"
  section TEXT,
  text    TEXT
);

CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);  -- build_date, n_docs, n_chunks, embed_model, embed_dims
