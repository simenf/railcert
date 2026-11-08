# Railcert – European & Norwegian railway regulation library

Collected 2026-11-08 · 991 documents (1.01 GB) · reference map with 12,026 citation links

Open **`99_Reference_Map/reference_map.html`** in a browser to explore which document cites which. A copy with source links only, ready for public hosting, is in `99_Reference_Map/online/`. All source URLs are in **`catalogue.tsv`**. To refresh or re-download, run `bash download_all.sh` from this folder; it skips files that are already present.

---

## 1. How the rules fit together

| Layer | What it is | Where in this folder |
|---|---|---|
| **EU framework (4th Railway Package)** | Directive (EU) 2016/797 *Interoperability*, Directive (EU) 2016/798 *Safety*, Regulation (EU) 2016/796 *ERA*. Also Directive 2012/34 (SERA) and Directive 2007/59 (train drivers). | `01_EU_Framework` |
| **TSIs** | Technical Specifications for Interoperability, one per subsystem: CCS, ENE, INF, LOC&PAS, WAG, NOI, OPE, PRM, SRT and Telematics. The 2023 package (2023/1693, /1694, /1695) amends them; later amendments are listed below. Each TSI folder holds the base act, every amending act and the latest consolidated text. | `02_TSI/<TSI>` |
| **CSMs and safety** | CSM RA (402/2013 as amended by 2015/1136), CSM monitoring (1078/2012), CSM supervision (2018/761), CSM SMS requirements (2018/762), single safety certificate (2018/763), ECM (2019/779), CSIs and accident reporting. | `03_CSM_Safety` |
| **Conformity assessment (NoBo / DeBo / AsBo)** | Decision 2010/713 (modules), Implementing Regulation 2019/250 (templates for EC declarations and certificates). The NoBo is notified under Chapter VI of Dir 2016/797. The DeBo checks national rules (Art. 15(8)); there is no separate EU act. The AsBo is the independent assessment body under CSM RA Art. 6 and Annex II. | `04_Conformity_Assessment` |
| **Vehicle authorisation and registers** | Implementing Regulation 2018/545 (practical arrangements, incl. 2020/781), ERA fees 2018/764 (rev. 2024/2018), EVR 2018/1614, ERATV 2011/665, RINF 2019/777. | `05_Vehicle_Authorisation_Registers` |
| **ERA guidance** | PA VA guidelines (ERA1209/222), OSS guides, clarification notes, SSC/SMS/supervision guides, the CSM RA guide and AsBo RFUs, TSI application guides, register guides, NB-Rail RFUs, SRD/national rules. | `06_ERA_Guides/<topic>` |
| **ERTMS specifications – all baselines** | Every set of specifications ERA publishes for the CCS TSI, one folder per set: **Set 1** (ETCS B2, GSM-R B1), **Set 2** (ETCS B3 MR1), **Set 3** (ETCS B3 R2, system version 3.6.0, as deployed in Norway), **Set 4** (current: ETCS B4 R1, RMR GSM-R B1 MR1, FRMCS B0, ATO B1 R1) and the **informative** specifications (FMEAs, hazard log, safety analyses). Each set holds SUBSET-026 SRS, 027, 034–041, 054–058, 076 test specifications, 091, 104 and the others, plus the FRS, DMI and EIRENE in that set's version. Files keep ERA's index numbers so they sort as in ERA's lists. ESC/RSC documents and the braking-curve tool are at the folder root. | `07_ERTMS_Specifications/<set>` |
| **Norway** | Jernbaneloven; samtrafikkforskriften FOR-2021-09-09-2742; sikkerhetsforskriften FOR-2021-09-08-2740; the NoBo/DeBo regulation FOR-2021-09-08-2705; CSM RA FOR-2014-10-27-1344; TSI CCS FOR-2025-03-14-450; other EEA implementing regulations; SJT guidance; Bane NOR (Network Statement 2027, TJN). **ATC-2 STM specifications** (STM FRS BVS 544.65001 and TR GRS 100200 E004) in every version SJT publishes: v6.1 (2017, current), v6.0 (2014), v5.2 (2014) and v5.1 (2009), one subfolder per version, plus the STM RAMS requirements (version A, 2008). The FRS consists of chapters 1 (innledning), 3, 4, 5 and 8; the numbering follows the ATC-2 handbook, so there are no chapters 2, 6 or 7. | `08_Norway/<area>`, `08_Norway/ATC2_STM_Specifications/<version>` |
| **Cybersecurity: Cyber Resilience Act** | Regulation (EU) 2024/2847 (CRA) and its EN corrigendum, Delegated Reg 2025/1535 (L-category exclusion), Implementing Reg 2025/2392 (important and critical products), Delegated Reg 2026/881 (delayed notifications), the Commission guidance C(2026) 5252 with its annex, and the Commission FAQ. Link files cover the M/606 standardisation request and ENISA's reporting platform. The instruments the CRA cites (per EUR-Lex) are in `09_Referenced_Documents/EU_Acts`: NLF, RED, NIS2, the Cybersecurity Act, eIDAS, GDPR, the AI Act, UNECE R155 and others. Rail is not among the exclusions in Art. 2(2)–(4), which cover only medical devices, motor vehicles under 2019/2144, certified aviation products and marine equipment. No Art. 2(5) delegated act limits the CRA for rail; the only one so far is 2025/1535, for L-category vehicles. Connected rail products with digital elements are therefore in scope from 11 Dec 2027. | `10_Cybersecurity_CRA` |
| **Referenced documents** | Free documents cited by the core set and downloaded one level deep: older or related EU acts, ETSI GSM-R/FRMCS/3GPP specs, further UNISIG subsets and ERA technical documents. | `09_Referenced_Documents/<type>` |
| **Reference map** | Interactive explorer, standards register and CSV exports. | `99_Reference_Map` |

### Typical paths through the rules

- **Vehicle authorisation (placing on the market):**
  1. Dir 2016/797 Art. 21 → Impl. Reg 2018/545
  2. ERA PA VA guidelines (ERA1209/222) and the OSS applicant guide
  3. Pre-engagement (optional)
  4. Requirements capture using CSM RA 402/2013 Annex I
  5. Verification: NoBo for TSIs (2010/713 modules, 2019/250 templates), DeBo for Norwegian national rules (SRD, FOR-2021-09-08-2705), AsBo for CSM RA
  6. Application via the OSS
  7. Registration in the EVR (2018/1614)
  8. Route compatibility check (OPE TSI 2019/773 §4.2.2.5) before use
- **Placing fixed installations (trackside CCS, ENE, INF) in service in Norway:** samtrafikkforskriften and SJT's guidance on infrastructure applications, plus the ERA pre-approval for ERTMS trackside (Dir 2016/797 Art. 19).
- **Safety:** Dir 2016/798 → single safety certificate 2018/763, SMS requirements 2018/762, CSM RA, CSM monitoring 1078/2012, supervision 2018/761, ECM 2019/779. In Norway: sikkerhetsforskriften and the SJT guides.

## 2. Recent changes to note (status 7 Nov 2026)

- **CCS TSI**: Implementing Reg (EU) **2026/693** amends 2023/1695, in force 5 May 2026. It adds new test specifications, a set of reduced specifications and clarified transition rules. The consolidated text 02023R1695-20260505 is in `02_TSI/CCS`. Norway is implementing it by amending FOR-2025-03-14-450 (SJT hearing Jun–Aug 2026). ERA's CCS application guide is still v3.1 (Dec 2024).
- **Telematics TSI**: Implementing Reg (EU) **2026/253** merges TAF and TAP. It entered into force on 2 Mar 2026, with phased application to 2 Mar 2027. TAP 454/2011 and TAF 1305/2014 are repealed and kept as historical rows.
- **WAG TSI**: amended by 2025/2064 (4 Nov 2025). **LOC&PAS TSI and ERATV**: amended by 2025/675 (27 Apr 2025).
- **ERA fees**: Reg 2018/764 was revised by 2024/2018 (applies from 1 Oct 2024).
- **Directive 2016/797**: Art. 5(12) was added by the AI Act (Reg 2024/1689) and applies from 2 Aug 2026.
- **Cyber Resilience Act**: notified body provisions apply from 11 Jun 2026, Art. 14 vulnerability and incident reporting from 11 Sep 2026, and full application from 11 Dec 2027. The Commission guidance C(2026) 5252 was published on 27 Jul 2026, and the first harmonised standards (M/606) are due from Q3 2026.
- **SERA**: the new capacity Regulation (EU) 2026/1184 amends Dir 2012/34 and repeals Reg 913/2010, with phased application to 2030.
- **No amendments found** since those already listed for CSM RA 402/2013 (only 2015/1136), 2018/545 (only 2020/781), 2010/713 or 2016/796. The revision of the train driver directive 2007/59 is still in preparation.
- **Norway**: Network Statement 2027 applies from 13 Dec 2026, and TJN revision 2026 takes effect the same day. Jernbanekjøretøyforskriften was not found on Lovdata under FOR-2022-05-25-923, and its status is unconfirmed (see the note in the catalogue).

## 3. Standards (EN / IEC / ISO / CLC / UIC)

The TSIs and guides cite 659 distinct EN/IEC/ISO/CLC/CEN standards and 137 UIC leaflets. These are **copyrighted and sold** by CEN/CENELEC, IEC, ISO and UIC (in Norway through Standard Norge), so they are **listed, not downloaded**. `99_Reference_Map/standards_register.csv` gives, for each standard:
- the versions cited (for example EN 50126-1:2017),
- how many documents cite it,
- exactly which documents cite it.

Free standards were downloaded: 31 ETSI specifications (GSM-R, FRMCS, 3GPP, EN 301 515 and others) are in `09_Referenced_Documents/ETSI`. ERA's own list of standards cited in the TSIs is `06_ERA_Guides/TSI_Application_Guides` (xlsx).

Most cited: EN 50129 (59), EN 50126 (52), EN 50159 (41), EN 50128 (40), EN 50125-1 (35), EN 50155 (33), EN 50121-3-2 (24), EN 14363 (22), EN 15528 (21), ISO 9001 (21), EN 50126-1 (20), EN 50367 (18), EN 50121-4 (18), EN 50125-3 (18), EN 13979-1 (17)

## 4. Reference map (`99_Reference_Map`)

The map comes in two editions built from the same data:

| Edition | File | Document links | Use |
|---|---|---|---|
| **Local** | `99_Reference_Map/reference_map.html` | 📄 opens your downloaded PDF (relative link into this folder), ↗ opens the official source | Open from this folder on your own machine. Keep the folder structure intact. |
| **Online** | `99_Reference_Map/online/index.html` | ↗ official source only; no copies hosted | Public hosting, for example on Cloudflare Pages (see `online/DEPLOY.md`). Its footer credits EUR-Lex/Commission (Decision 2011/833/EU), ERA and Lovdata. |

Both editions are regenerated every time the map is rebuilt. Upload only the `online` folder. Don't upload the PDF folders or the local edition.

- Both editions have five views. The map opens on the first one:
  - *Navigator*: the library as a hierarchy that starts at the top and works down. **EU law** starts from the basic acts (Interoperability Directive, Railway Safety Directive, ERA Regulation, SERA, train drivers, CRA, AI Act). Below them come the implementing and delegated acts (TSIs, CSMs, 2018/545, 2010/713, registers), then the mandatory specifications (CCS TSI Annex A sets), then guidance (ERA guides, clarification notes, RFUs), and finally the standards and referenced documents. **Norway** starts from Jernbaneloven, and each regulation shows the EU act it implements (⇄, click to jump there). Each document appears once: under the higher-level act it shares the most citations with, or where a hand-set rule puts it. Other parents are listed as "Also used by" in the detail panel. Amending, correcting, consolidated and superseded acts fold under the current act ("Versions, amendments & superseded acts"). Each list shows its eight most-cited items first, with "show more" for the rest. Rows carry a status badge (in force, amended, repealed, superseded, draft) and the 📄 / ↗ links. Clicking a row opens the Explorer's detail panel with a breadcrumb trail, and the search box jumps to a document's place in the tree. **Task paths** gives step-by-step routes with links for eight common jobs: authorising a vehicle, putting ETCS on-board or trackside CCS into service in Norway, CSM RA and the AsBo, the ATC-2 STM, the CRA for rail products, juridical recording, and the single safety certificate with SMS. The rules are in `tools/nav_config.py`; after editing them, run `python3 tools/build_nav.py`. It re-renders both editions from the data already in the map, so it needs neither the documents nor pdftotext.
  - *Vehicle authorisation*: two linked diagrams of Regulation (EU) 2018/545 and the PA VA guidelines. **Process** runs from choosing the authorisation case (Art. 14) and the Art. 15(1) test for changes (categories a–d, the Directive Art. 21(12) criteria and basic design characteristics), through the conformity-to-type fast track and the six stages (preparation, pre-engagement, conformity assessment, OSS application, assessment, decision), to ERATV, ERADIS and EVR registration and the route compatibility check. **Certificates & declarations** shows, in lanes by issuer (manufacturer, NoBo, DeBo, AsBo, applicant, authorising entity, registers), how certificates, intermediate statements, AsBo reports, EC declarations, the application file and the authorisations build on each other. Picking a box shows what it is, its legal basis with links to the documents, and what it connects to; process steps link to the documents they produce and back. The content is in `tools/va_config.py`, and every reference is checked when the map is built.
  - *Explorer*: pick a document or a standard (search by number or by title). By default the search covers everything: every library document, plus every cited item that is not in the library. The scope menu narrows it to library documents or to standards. A citation graph centred on it shows the documents that cite it on the left and what it cites on the right. Click any node to re-centre the graph on it. Below the graph are the full lists, grouped by type. In the local edition, "📄 Open local file" opens the PDF.
  - *Graph*: an overview of citations between library documents. You can optionally add the standards cited by five or more documents. The layout is computed when the map is built, so it doesn't move. Zoom, pan and drag nodes; double-click a node to open it in the Explorer.
  - *Standards register*: a sortable list of every cited standard, with its title, availability, versions cited and how many documents cite it.
  - **Short names**: TSIs, framework acts, CSMs, registers, horizontal EU legislation, Norwegian regulations and key ERA guides are shown with short names such as "CCS TSI", "CSM RA", "Vehicle Authorisation Regulation" or "Samtrafikkforskriften", followed by the act number. Amending and correcting acts are named after the act they change, for example "CCS TSI – amendment 2026/693". Older, superseded acts are marked "(old)". The list is `99_Reference_Map/short_names.tsv` (after editing it, the map must be rebuilt to pick up the changes), and the names also appear as the `short_name` column in `catalogue.tsv` and in `references_edges.csv`.
  - **Links (↗)**: every document and cited item links to its official source. These are EUR-Lex for EU acts, Lovdata for Norwegian regulations, ERA, SJT or Bane NOR for their documents, and ETSI's download directory for ETSI specs. Paid standards link to a search at Standard Norge (EN/ISO/CLC), the IEC webstore (IEC) or the UIC shop (UIC leaflets). In the Explorer graph, shift-click a node to open the local PDF in the local edition, or the official source in the online edition. In the local edition, the 📄 icons in the citation lists open the local copies.
- **references_edges.csv**: one row per (citing document → cited item), with mention count and versions cited.
- **standards_register.csv**: the standards list described in section 3, with titles and where each title came from.

**Standard titles** come from, in order of priority: ERA's *Standards quoted in TSIs* list (official titles); ETSI cover pages for specs in the library; a curated list of widely used standards (marked "check edition"); and the title printed next to the reference in the citing documents. Series references such as EN 13103 take the series title from their parts. 486 of the 1022 cited standards have a title. Together they account for about 78% of all citations to standards.

**Method.** Text was extracted from every PDF and HTML file with pdftotext. Citations were matched with patterns for:
- EU acts, in English and Norwegian wording ("forordning (EU) nr. 402/2013", "forskrift 9. september 2021 nr. 2742");
- EN/IEC/ISO/CLC/CEN/ETSI/UIC numbers, with years and amendments;
- SUBSET-xxx, ERA document IDs, and FOR/LOV identifiers.

Hyphens that some ERA PDFs drop (for example "EN 455454" for EN 45545-4) are repaired using the hyphenated forms seen elsewhere in the corpus. Self-citations are removed. Limits:
- Zip archives (SUBSET-026, the DMI spec, some test specifications), spreadsheets and link files are not parsed. Each ETCS set cites its own subset versions, and on the map a cited SUBSET resolves to the current (B4) version first; older versions are listed with it.
- References are found by pattern, not read by a person, so a few false positives remain. They show up in the Explorer as rarely cited items under "Cited, not in library".

## 5. What could not be downloaded

- **134 link files (`*.url.txt`)**: web pages, databases and portals with no downloadable file, such as ERA's SRD/RDD, the OSS portal, many SJT guidance pages and the ERTMS spec folders. Each holds the title and URL.
- **Paid standards**: EN/IEC/ISO/CLC and UIC are listed in `99_Reference_Map/standards_register.csv`, not downloaded.
- **ETCS test-sequence archives** (SUBSET-076-6-3 test sequences and SUBSET-103 Euroloop TSOE parts, about 100–150 MB per part and roughly 5 GB in total across the four sets) are machine-readable test-lab data. They are linked, not downloaded: each part has a `.url.txt` in its set folder. The test specification documents themselves (SUBSET-076-x, SUBSET-103) are downloaded.
- **Jernbanekjøretøyforskriften**: no Lovdata entry found under FOR-2022-05-25-923; SJT's text is linked instead. Bane NOR's ERTMS system descriptions on oppslagsverk.banenor.no block scripts, so they are linked.
- **ERA documents no longer published**: the 2011 SMS/ECM guides (GUI/01–05-2011 and GUI/08–11-2011, superseded), ERA recommendations from before 2015, ERA-TD-101, ERA/REP/13-2011 and ERA/INF/10-2009. **UNISIG subsets not public**: SUBSET-110/111 (interoperability test documents) and 131 (unpublished).
- **27 cited EU acts not available on EUR-Lex**: most are extraction noise, such as a footnote digit glued to an act number (2016/7972). Others are acts with no English text online. All are listed in `catalogue_not_downloaded.tsv`.

- **Removed as off-topic**: 68 acts cited only by the AI Act (Reg 2024/1689), such as banking, medical-device, Schengen and asylum law, were deleted on 8 Nov 2026. The exceptions are acts that the CRA also cites, which were downloaded again. Their citations still appear on the reference map as "not in library". The review list is `EU_Acts_review.csv`.
- **CRA**: the M/606 standardisation request (Commission documents register, JavaScript only) and CELEX 32024C0678 (no English text on EUR-Lex) are not downloaded.

## 6. Repository, licensing and rebuilding

The GitHub repository holds **the map, the catalogue and the tools, not the documents**. `.gitignore` excludes everything inside the document folders (`01_…` to `10_…`) except the `*.url.txt` link files. This is because ETSI, UIC/EIRENE, UNISIG, the standards bodies and several national publishers do not allow redistribution, while linking to them is always fine.

| Path | What it is |
|---|---|
| `catalogue.tsv`, `catalogue_not_downloaded.tsv` | Every document with folder, file name, title, reference, status, official URL and short name |
| `download_all.sh` | Rebuilds the document folders from `catalogue.tsv` on your own machine |
| `99_Reference_Map/` | Local and online editions of the map, plus the CSV exports |
| `99_Reference_Map/online/` | The folder Cloudflare Pages publishes (see `online/DEPLOY.md`) |
| `tools/` | Harvesting and build scripts. `tools/data/` holds the per-source catalogue TSVs that `finalize.sh` merges |
| `tools/nav_config.py`, `tools/navigator.py` | Navigator rules (top of the hierarchy, Norway ⇄ EU links, placement overrides, task paths) and the code that builds the tree |
| `tools/va_config.py` | Content of the Vehicle authorisation tab: process steps, certificates and declarations, their links and legal references |

**Rebuilding from a fresh clone:**
1. `bash download_all.sh`
2. `bash tools/finalize.sh` (needs python3 with openpyxl and numpy, plus pdftotext from poppler)
3. Commit and push. Cloudflare redeploys automatically.

`finalize.sh` refuses to run when the documents are missing, because the catalogue keeps only rows whose file exists.

## 7. Folder contents

| Folder | Files | Size |
|---|---:|---:|
| `01_EU_Framework` | 18 | 12.7 MB |
| `02_TSI/Amending_packages` | 4 | 8.5 MB |
| `02_TSI/CCS` | 4 | 9.5 MB |
| `02_TSI/ENE` | 2 | 1.4 MB |
| `02_TSI/INF` | 2 | 3.4 MB |
| `02_TSI/LOC_PAS` | 3 | 5.6 MB |
| `02_TSI/NOI` | 3 | 1.3 MB |
| `02_TSI/OPE` | 6 | 17.6 MB |
| `02_TSI/PRM` | 5 | 3.0 MB |
| `02_TSI/SRT` | 4 | 1.8 MB |
| `02_TSI/TELEMATICS` | 13 | 9.2 MB |
| `02_TSI/WAG` | 5 | 5.4 MB |
| `03_CSM_Safety` | 20 | 13.0 MB |
| `04_Conformity_Assessment` | 4 | 2.4 MB |
| `05_Vehicle_Authorisation_Registers` | 14 | 8.1 MB |
| `06_ERA_Guides/CSM_RA` | 14 | 16.5 MB |
| `06_ERA_Guides/NoBo_DeBo_NNTR` | 13 | 5.2 MB |
| `06_ERA_Guides/Registers` | 6 | 10.0 MB |
| `06_ERA_Guides/Safety_Certification` | 11 | 22.8 MB |
| `06_ERA_Guides/TSI_Application_Guides` | 22 | 26.7 MB |
| `06_ERA_Guides/Vehicle_Authorisation` | 15 | 15.7 MB |
| `07_ERTMS_Specifications` | 10 | 5.9 MB |
| `07_ERTMS_Specifications/Informative_specs` | 48 | 52.1 MB |
| `07_ERTMS_Specifications/Set1_ETCS_B2` | 72 | 71.7 MB |
| `07_ERTMS_Specifications/Set2_ETCS_B3_MR1` | 74 | 89.9 MB |
| `07_ERTMS_Specifications/Set3_ETCS_B3_R2` | 76 | 108.8 MB |
| `07_ERTMS_Specifications/Set4_ETCS_B4_R1_current` | 105 | 101.6 MB |
| `08_Norway/ATC2_STM_Specifications` | 1 | 0.1 MB |
| `08_Norway/ATC2_STM_Specifications/v5.1_2009` | 6 | 6.7 MB |
| `08_Norway/ATC2_STM_Specifications/v5.2_2014` | 6 | 6.1 MB |
| `08_Norway/ATC2_STM_Specifications/v6.0_2014` | 6 | 6.3 MB |
| `08_Norway/ATC2_STM_Specifications/v6.1_2017` | 6 | 8.7 MB |
| `08_Norway/Bane_NOR` | 10 | 3.9 MB |
| `08_Norway/Lover_og_forskrifter` | 32 | 3.3 MB |
| `08_Norway/Nasjonale_regler_NNTR` | 6 | 3.6 MB |
| `08_Norway/SJT_Veiledninger` | 21 | 3.7 MB |
| `09_Referenced_Documents/ERA_Documents` | 48 | 84.5 MB |
| `09_Referenced_Documents/ERTMS_Subsets` | 1 | 0.0 MB |
| `09_Referenced_Documents/ETSI` | 34 | 15.8 MB |
| `09_Referenced_Documents/EU_Acts` | 230 | 239.3 MB |
| `10_Cybersecurity_CRA` | 11 | 5.8 MB |