import schema from "../schema.sql?raw";
import { _resetDocCache } from "../src/docs";

export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const DOCS = [
  // id, path, title, reference, short_name, status, area, ertms_set, lang, url, n_pages, r2_key, duplicate_of
  [1, "02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf", "Commission Implementing Regulation (EU) 2023/1695 on the TSI for control-command and signalling", "Implementing Regulation (EU) 2023/1695", "CCS TSI", "consolidated", "TSI", null, "en", "https://eur-lex.europa.eu/eli/reg_impl/2023/1695/oj", 300, "02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf", null],
  [2, "01_EU_Framework/Directive_2016_797.pdf", "Directive (EU) 2016/797 on the interoperability of the rail system", "Directive (EU) 2016/797", "Interoperability Directive", "in_force", "EU_Framework", null, "en", "https://eur-lex.europa.eu/eli/dir/2016/797/oj", 80, "01_EU_Framework/Directive_2016_797.pdf", null],
  [3, "07_ERTMS_Specifications/Set3/SUBSET-026.zip", "SUBSET-026 System Requirements Specification 3.6.0", null, "SUBSET-026 (Set 3)", "in_force", "ERTMS_Specifications", "Set3", "en", "https://www.era.europa.eu/", null, "07_ERTMS_Specifications/Set3/SUBSET-026.zip", null],
  [4, "08_Norway/Lovdata/samtrafikkforskriften.html", "Forskrift om samtrafikkevne i jernbanesystemet (samtrafikkforskriften)", "FOR-2021-09-09-2742", "Samtrafikkforskriften", "in_force", "Norway", null, "no", "https://lovdata.no/forskrift/2021-09-09-2742", null, "08_Norway/Lovdata/samtrafikkforskriften.html", null],
  [5, "08_Norway/Bane_NOR/Teknisk_regelverk/501/kap5.html", "Felles bestemmelser kap. 5", null, "TRV 501", "in_force", "Norway", null, "no", "https://trv.banenor.no/", null, "08_Norway/Bane_NOR/Teknisk_regelverk/501/kap5.html", null],
  [6, "02_TSI/CCS/CCS_TSI_2016_919.pdf", "Commission Regulation (EU) 2016/919 CCS TSI", "Regulation (EU) 2016/919", "CCS TSI (old)", "repealed", "TSI", null, "en", "https://eur-lex.europa.eu/eli/reg/2016/919/oj", 100, "02_TSI/CCS/CCS_TSI_2016_919.pdf", null],
  [7, "09_Referenced_Documents/copy_of_2016_797.pdf", "Directive (EU) 2016/797 (copy)", "Directive (EU) 2016/797", null, "in_force", "Referenced_Documents", null, "en", null, 80, null, "01_EU_Framework/Directive_2016_797.pdf"],
] as const;

export const CHUNKS = [
  // id, doc_id, ord, heading, locator, inner_file, page_start, page_end, anchor, text
  [101, 1, 0, "Article 1", "Art. 1", null, 1, 1, null, "This Regulation establishes the technical specification for interoperability relating to the control-command and signalling subsystems (CCS TSI)."],
  [102, 1, 5, "Annex > 4.2 Functional and technical specifications", "§4.2", null, 14, 15, null, "The ETCS on-board shall comply with the requirements of SUBSET-026 for level transitions and mode transitions. The set of specifications # 3 applies."],
  [103, 1, 6, "Annex > 6 Assessment of conformity", "§6", null, 40, 41, null, "The notified body shall verify the EC declaration of verification. Risk acceptance principles of the CSM RA apply."],
  [201, 2, 0, "Article 15", "Art. 15", null, 20, 20, null, "Article 15 Procedure for the EC declaration of verification. 8. The designated body (DeBo) shall be responsible for the verification of national rules notified in accordance with Article 14."],
  [202, 2, 1, "Article 15", "Art. 15(8)", null, 20, 21, null, "Where national rules apply, the applicant shall designate one or more bodies responsible for the verification procedure in respect of those rules (DeBo)."],
  [203, 2, 2, "Article 21", "Art. 21", null, 25, 26, null, "Vehicle authorisation for placing on the market. The applicant shall submit the application for a vehicle authorisation via the one-stop shop (OSS) referred to in Article 12 of Regulation (EU) 2016/796."],
  [301, 3, 0, "3.5 Management of radio communication", "§3.5.3.7", "SUBSET-026-3 v360.pdf", 12, 13, null, "3.5.3.7 If the establishment of a communication session is initiated by the on-board, it shall be performed according to the following steps. The ERTMS/ETCS on-board equipment shall send a request."],
  [302, 3, 1, "3.5 Management of radio communication", "§3.5.3.8", "SUBSET-026-3 v360.pdf", 13, 13, null, "3.5.3.8 The trackside shall respond to the request within the time-out."],
  [401, 4, 0, "§ 3-1 Krav til godkjenning", "§ 3-1", null, null, null, "§3-1", "§ 3-1. Ibruktakelse av faste installasjoner. Delsystemer skal ha tillatelse fra Statens jernbanetilsyn før de tas i bruk. Søknad om tillatelse skal inneholde verifiseringserklæring. Særlige krav for kjøretøy på strekninger med æ, ø og å."],
  [501, 5, 0, "5.2 Krav", "TRV-07113", null, null, null, "TRV-07113", "TRV-07113 Sporveksler skal ha sporvekselvarme på strekninger med snø og is."],
  [601, 6, 0, "Annex > 4.2", "§4.2", null, 10, 10, null, "Old CCS TSI: The ETCS on-board shall comply with SUBSET-026 version 3.4.0 for level transitions."],
  [701, 7, 0, "Article 15", "Art. 15", null, 20, 20, null, "Article 15 Procedure for the EC declaration of verification. 8. The designated body (DeBo) shall be responsible for the verification of national rules notified in accordance with Article 14."],
] as const;

export async function loadFixture(db: D1Database): Promise<void> {
  _resetDocCache();
  const stmts = splitSql(schema).map((s) => db.prepare(s));
  await db.batch(stmts);
  const ins: D1PreparedStatement[] = [];
  for (const d of DOCS) {
    const [id, path, title, reference, short_name, status, area, set, lang, url, n_pages, r2, dup] = d;
    ins.push(
      db
        .prepare(
          "INSERT INTO docs (id, path, folder, filename, title, reference, short_name, date_status, status, area, ertms_set, lang, url, notes, n_pages, r2_key, duplicate_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(id, path, path.split("/").slice(0, -1).join("/"), path.split("/").pop()!, title, reference, short_name, null, status, area, set, lang, url, null, n_pages, r2, dup),
    );
  }
  for (const c of CHUNKS) {
    ins.push(
      db
        .prepare("INSERT INTO chunks (id, doc_id, ord, heading, locator, inner_file, page_start, page_end, anchor, text, tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(...c, 50),
    );
  }
  const aliases: [string, string, string][] = [
    ["ccs tsi", DOCS[0][1], "short"],
    ["2023/1695", DOCS[0][1], "number"],
    ["interoperability directive", DOCS[1][1], "short"],
    ["2016/797", DOCS[1][1], "number"],
    ["samtrafikkforskriften", DOCS[3][1], "short"],
    ["for-2021-09-09-2742", DOCS[3][1], "lovdata"],
  ];
  for (const a of aliases) ins.push(db.prepare("INSERT INTO aliases (alias, path, kind) VALUES (?,?,?)").bind(...a));
  ins.push(db.prepare("INSERT INTO trv (req_id, path, anchor, section, text) VALUES (?,?,?,?,?)").bind("TRV:07113", DOCS[4][1], "TRV-07113", "5.2 Krav", "Sporveksler skal ha sporvekselvarme."));
  ins.push(
    db
      .prepare("INSERT INTO edges (citing_path, cited_id, cited_type, cited_label, cited_short_name, cited_title, mentions, versions_cited, cited_path) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(DOCS[0][1], "32016L0797", "eu_act", "Directive (EU) 2016/797", "Interoperability Directive", null, 12, null, DOCS[1][1]),
  );
  ins.push(db.prepare("INSERT INTO standards (standard, title, type, availability, link, versions_cited, cited_by_n_docs, citing_documents, file_in_library) VALUES (?,?,?,?,?,?,?,?,?)").bind("EN 50126-1", "Railway applications - RAMS - Part 1", "EN", "paid", null, "EN 50126-1:2017", 1, DOCS[0][1], null));
  ins.push(db.prepare("INSERT INTO meta (k, v) VALUES ('build_date', '2026-11-23'), ('n_docs', '7'), ('n_chunks', '12')"));
  ins.push(db.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')"));
  await db.batch(ins);
}
