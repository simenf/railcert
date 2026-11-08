# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted equally:

- **The owner and their team:** railway certification and safety engineers using the map as a daily working tool on NoBo, DeBo and AsBo assessments, vehicle authorisation and ERTMS projects. They mostly use the local edition, which opens the downloaded PDFs.
- **Rail professionals elsewhere:** engineers, assessors and applicants who reach the public online edition with no prior context. They need to find their way in without knowing how the library is organised.

Both use it for the same job: getting from a regulatory question to the right act, specification, guide or standard, and seeing how those documents connect.

## Product Purpose

Railcert is a library of EU and Norwegian railway regulation: 991 documents, plus 12,026 citation links between them and the items they cite. The reference map is how people use it. Success means a user gets from "where do I start?" to the right PDF or official link in a few clicks, and understands where that document sits in the legal hierarchy.

## Positioning

Three things set it apart from ERA's website, EUR-Lex and Lovdata:

- **Citation-derived links:** the map shows which document cites which, so a requirement can be traced from the law down to the specification and the standard.
- **Fast route to the right file:** a hierarchy, search and direct 📄 (local copy) and ↗ (official source) links on every row.
- **Task paths for real jobs:** guided step-by-step routes through common certification work, not just a catalogue.

## Operating Context

- **Two editions** are generated from the same data:
  - local: `99_Reference_Map/reference_map.html`, which opens files in the downloaded library folder;
  - online: `99_Reference_Map/online/index.html`, published by Cloudflare Pages from the GitHub repository.
- **Views:**
  - Navigator (the opening tab): EU and Norway trees and task paths;
  - Explorer: a citation graph and lists for one document;
  - Graph: an overview of citations between library documents;
  - Standards register;
  - Missing / external.
- **Content:** EU acts (TSIs, CSMs, 2018/545, 2010/713, registers, the CRA), ERA guidance, ERTMS specification sets 1–4, Norwegian law and SJT guidance, ATC-2 STM specifications, and Bane NOR documents. Short names like "CCS TSI" and "Samtrafikkforskriften" are the shared vocabulary.
- **Users work** alongside the official sources (EUR-Lex, ERA, Lovdata, SJT, NB-Rail) and paid standards (Standard Norge, IEC, UIC).

## Capabilities and Constraints

- **No hosted copies online:** the online edition must link only to official publishers and never redistribute documents. ETSI, UIC, UNISIG, the standards bodies and some national publishers don't allow redistribution. The repository also excludes the documents themselves.
- **English UI:** the interface language stays English. Norwegian titles and regulation names appear as they are.
- **Paid standards** (EN, IEC, ISO, CLC, UIC) are listed by reference only, with store links.
- **Current implementation, not a stated requirement:**
  - Python scripts in `tools/` generate one self-contained HTML file per edition from `tools/map_template.html`; there is no frontend framework;
  - the Navigator hierarchy is hand-set in `tools/nav_config.py`;
  - `tools/build_nav.py` re-renders the map without the documents.
- **Undecided:** whether the single-file, no-build approach is a binding constraint. It wasn't confirmed as one.

## Evidence on Hand

- **Real data:** `catalogue.tsv`, `99_Reference_Map/references_edges.csv`, `99_Reference_Map/standards_register.csv` and `99_Reference_Map/short_names.tsv`, plus the README's "Typical paths through the rules".
- **No testimonials, user counts, endorsements or official affiliation exist.** Don't invent any.
- The online footer credits EUR-Lex/Commission (Decision 2011/833/EU), ERA and Lovdata. It says the map is an independent compilation and should be verified against the official text. The user didn't confirm this as a binding brand commitment, but it describes the product accurately and shouldn't be removed without asking.

## Product Principles

1. **Get to the right file fast.** Every view should end in a working local or official link.
2. **Show the structure, not just the list.** Where a document sits (law → implementing act → specification → guidance → standard) is part of the answer.
3. **Use the citations as evidence.** Links come from the documents' own references, and hand-set rules correct them openly in config, not silently.
4. **Serve the newcomer and the expert at once.** Task paths and breadcrumbs for people with no context; search, dense rows and direct jumps for daily users.
5. **Link, don't host.** Respect publishers' licensing in every edition that leaves the owner's machine.
