const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageNumber, PageBreak, TableOfContents, Footer, Header,
  VerticalAlign
} = require('docx');
const fs = require('fs');


// ─── Colour palette ───────────────────────────────────────────────────────────
const DARK_NAVY   = "0B1D3A";
const MID_NAVY    = "163359";
const ACCENT_BLUE = "1E5FA8";
const LIGHT_BLUE  = "D6E4F7";
const MID_BLUE    = "A8C8F0";
const LIGHT_GREY  = "F0F4FA";
const MID_GREY    = "D0D8E8";
const BORDER_COL  = "B0C4DE";
const AMBER       = "E07B00";
const AMBER_LIGHT = "FFF3DC";
const GREEN_DARK  = "1A6B35";
const GREEN_LIGHT = "DCF5E5";
const RED_DARK    = "8B1A1A";
const RED_LIGHT   = "FDECEA";


// ─── Helpers ──────────────────────────────────────────────────────────────────
const cellBorder = (color = BORDER_COL) => ({
  top: { style: BorderStyle.SINGLE, size: 1, color },
  bottom: { style: BorderStyle.SINGLE, size: 1, color },
  left: { style: BorderStyle.SINGLE, size: 1, color },
  right: { style: BorderStyle.SINGLE, size: 1, color },
});


function hdr1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 36, color: DARK_NAVY, font: "Arial" })],
  });
}
function hdr2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 28, color: MID_NAVY, font: "Arial" })],
  });
}
function hdr3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: ACCENT_BLUE, font: "Arial" })],
  });
}
function hdr4(text) {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true, size: 22, color: AMBER, font: "Arial" })],
  });
}
function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, size: 22, font: "Arial", color: "222222", ...opts })],
    ...(opts.indent ? { indent: { left: 720 } } : {}),
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 21, font: "Arial", color: "222222" })],
  });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function divider(color = BORDER_COL) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color } },
    children: [],
  });
}
function badge(text, fill, textColor) {
  return new TableCell({
    borders: cellBorder(fill),
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, size: 19, bold: true, color: textColor, font: "Arial" })] })],
  });
}


// ─── Summary stat box ─────────────────────────────────────────────────────────
function statRow(items) {
  // items = [{label, value, fill, tc}]
  const cols = items.map(it => Math.floor(9360 / items.length));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: items.map(() => Math.floor(9360 / items.length)),
    rows: [
      new TableRow({
        children: items.map(it =>
          new TableCell({
            borders: cellBorder(it.fill || BORDER_COL),
            shading: { fill: it.fill || LIGHT_BLUE, type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: it.value, size: 40, bold: true, color: it.tc || DARK_NAVY, font: "Arial" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: it.label, size: 18, color: "444444", font: "Arial" })] }),
            ],
          })
        ),
      }),
    ],
  });
}


// ─── Standard table ──────────────────────────────────────────────────────────
function makeTable(headers, colWidths, rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          new TableCell({
            borders: cellBorder(ACCENT_BLUE),
            shading: { fill: DARK_NAVY, type: ShadingType.CLEAR },
            width: { size: colWidths[i], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: h, size: 20, bold: true, color: "FFFFFF", font: "Arial" })] })],
          })
        ),
      }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((cell, ci) =>
            new TableCell({
              borders: cellBorder(BORDER_COL),
              shading: { fill: ri % 2 === 0 ? "FFFFFF" : LIGHT_GREY, type: ShadingType.CLEAR },
              width: { size: colWidths[ci], type: WidthType.DXA },
              margins: { top: 70, bottom: 70, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: String(cell), size: 20, font: "Arial", color: "1A1A1A" })] })],
            })
          ),
        })
      ),
    ],
  });
}


// ─── Coloured section header bar ─────────────────────────────────────────────
function sectionBar(text, fill = DARK_NAVY, tc = "FFFFFF") {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: cellBorder(fill),
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 200, right: 200 },
        children: [new Paragraph({ children: [new TextRun({ text, size: 24, bold: true, color: tc, font: "Arial" })] })],
      })],
    })],
  });
}


// ════════════════════════════════════════════════════════════════════════════════
//  DOCUMENT CONTENT
// ════════════════════════════════════════════════════════════════════════


const children = [];


// ─── Cover page ──────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { before: 1440, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "TigerEx", size: 72, bold: true, color: DARK_NAVY, font: "Arial" })] }),
  new Paragraph({ spacing: { after: 160 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Complete Technical Specification", size: 36, color: ACCENT_BLUE, font: "Arial" })] }),
  new Paragraph({ spacing: { after: 400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Binance + Bybit Combined Architecture", size: 28, color: "555555", font: "Arial", italics: true })] }),
  divider(ACCENT_BLUE),
  new Paragraph({ spacing: { after: 80 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Languages  ·  File Counts  ·  Module Details  ·  Technology Stack", size: 22, color: "555555", font: "Arial" })] }),
  new Paragraph({ spacing: { after: 80 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Version 2.1 — May 2026", size: 22, color: "777777", font: "Arial" })] }),
  pageBreak(),
);


// ─── Executive summary stats ─────────────────────────────────────────────────
children.push(
  hdr1("1. Executive Summary"),
  para("TigerEx is a Binance + Bybit combined architecture crypto exchange. It encompasses every major product line from both platforms: spot and derivatives trading, unified trading account (UTA 2.0), TradFi / CFD / MT5, P2P, Earn, Copy Trading, Launchpad, Algo Bots, NFT, Crypto Loans, and Wealth Management. Below is the top-level engineering footprint."),
  new Paragraph({ spacing: { after: 160 } }),
);


children.push(
  statRow([
    { label: "Programming Languages",      value: "12",       fill: DARK_NAVY,   tc: "FFFFFF" },
    { label: "Infrastructure Languages",   value: "5",        fill: MID_NAVY,    tc: "FFFFFF" },
    { label: "Top-Level Domains",          value: "18",       fill: ACCENT_BLUE, tc: "FFFFFF" },
    { label: "Sub-Modules",                value: "520+",     fill: "1A6B8A",    tc: "FFFFFF" },
  ]),
  new Paragraph({ spacing: { after: 120 } }),
  statRow([
    { label: "Total Source Files (est.)",  value: "~2,900",   fill: GREEN_DARK,  tc: "FFFFFF" },
    { label: "Total Lines of Code (est.)", value: "~18M LOC", fill: GREEN_DARK,  tc: "FFFFFF" },
    { label: "Databases Used",            value: "14",        fill: AMBER,       tc: "FFFFFF" },
    { label: "Infrastructure Tools",      value: "24+",       fill: AMBER,       tc: "FFFFFF" },
  ]),
  new Paragraph({ spacing: { after: 240 } }),
);


// ─── Language overview table ──────────────────────────────────────────────────
children.push(
  hdr2("1.1 All Programming Languages at a Glance"),
  makeTable(
    ["#", "Language", "Primary Role", "Domains", "Est. Files", "Est. LOC"],
    [400, 1000, 3000, 2500, 1100, 1360],
    [
      ["1",  "C++",           "Ultra-low-latency matching engine, orderbooks, feed handlers, FPGA bridge",                 "Core Exchange Engine, Market Data",               "~320",  "~1.8M"],
      ["2",  "Rust",          "Security-critical: wallets, auth, risk engine, settlement, ledger, custody, loans",         "Auth, Risk, Wallets, Ledger, Earn, Loans",        "~580",  "~3.2M"],
      ["3",  "Go",            "Microservices, WebSocket APIs, streaming, P2P backend, copy trading, bots gateway",         "Messaging, P2P, Copy Trade, Infra, Growth",       "~480",  "~2.8M"],
      ["4",  "Java",          "Banking systems, compliance, KYC, accounting, CFD products, wealth management",             "Identity, Banking, KYC, TradFi, Launchpad",       "~420",  "~2.4M"],
      ["5",  "Python",        "AI/ML models, fraud detection, quant research, backtesting, LLM systems, analytics",        "AI/Quant, Fraud, Compliance analytics",           "~280",  "~1.6M"],
      ["6",  "TypeScript",    "Web frontend (Next.js/React), all dashboards, BFF layers, SDK, admin portals",              "Frontend Superapp, SDKs",                         "~380",  "~2.1M"],
      ["7",  "Kotlin",        "Android app — trading, earn, copy trade, P2P, TradFi mobile UIs",                          "Mobile Apps (Android)",                           "~120",  "~0.6M"],
      ["8",  "Swift",         "iOS app — secure enclave, Apple Pay, trading, earn, copy trade, P2P UIs",                  "Mobile Apps (iOS)",                               "~120",  "~0.6M"],
      ["9",  "Solidity",      "Smart contracts: RWA, staking, governance, launchpad, NFT, DeFi yield, vesting",           "Blockchain & Web3, Launchpad, NFT",               "~85",   "~0.3M"],
      ["10", "CUDA (C/C++)",  "GPU-accelerated AI training, inference, quant compute, parallel signal processing",         "AI/Quant Research",                               "~60",   "~0.25M"],
      ["11", "Verilog / VHDL","FPGA bitstream: packet processing, feed handlers, SmartNIC logic, HW trading paths",       "Infrastructure (bare-metal clusters)",            "~35",   "~0.12M"],
      ["12", "SQL / PL/pgSQL","Database schemas, stored procedures, migration scripts across 4 RDBMS targets",             "Database Architecture (all relational DBs)",       "~120",  "~0.5M"],
    ],
  ),
  new Paragraph({ spacing: { after: 200 } }),
);


children.push(
  hdr2("1.2 Infrastructure / Config / Tooling Languages"),
  makeTable(
    ["Tool Language", "Purpose", "Where Used", "Est. Files"],
    [1500, 3500, 2700, 1660],
    [
      ["HCL (Terraform)",     "Cloud infrastructure as code — clusters, networking, IAM, storage",     "infrastructure_and_sre / terraform",          "~180"],
      ["YAML",                "Kubernetes manifests, Helm charts, GitHub Actions CI, Argo CD pipelines","infrastructure_and_sre / kubernetes, argo_cd", "~420"],
      ["Dockerfile / Compose","Container image definitions for every service",                          "Every microservice root",                      "~260"],
      ["Makefile / Shell",    "Build automation, deployment scripts, local dev helpers",                "Monorepo root and each service",               "~140"],
      ["Cuelang / Jsonnet",   "Configuration-as-code for Kubernetes and Grafana dashboards",            "infrastructure_and_sre / observability",       "~60"],
    ],
  ),
  new Paragraph({ spacing: { after: 200 } }),
);


children.push(pageBreak());


// ════════════════════════════════════════════════════════════════════════════════
//  DOMAIN-BY-DOMAIN BREAKDOWN
// ════════════════════════════════════════════════════════════════════════════════
children.push(hdr1("2. Domain-by-Domain File Breakdown"));
para("Every domain section below lists: language used, total estimated files, sub-module catalogue with per-file breakdown, and technology notes.");


// Helper: domain section
function domainSection(num, title, langs, totalFiles, totalLOC, description, modules, techNotes) {
  // modules = [{name, lang, files, purpose}]
  const langsStr = langs.join(", ");
  const block = [];
  block.push(
    new Paragraph({ spacing: { before: 320, after: 0 } }),
    sectionBar(`Domain ${num}: ${title}   |   ${langsStr}   |   ~${totalFiles} files   |   ~${totalLOC} LOC`),
    para(description),
    new Paragraph({ spacing: { after: 80 } }),
  );


  // Module table
  block.push(
    makeTable(
      ["Module / Sub-System", "Language", "Key Files (examples)", "Purpose", "Files"],
      [2000, 900, 2500, 2600, 760],
      modules.map(m => [m.name, m.lang, m.files, m.purpose, String(m.count)]),
    ),
    new Paragraph({ spacing: { after: 120 } }),
  );
  return block;
}


// ════════════════════════════════════════════════════════════════════════════════
//  SECTION 3: COMPLETE FILE COUNT SUMMARY
// ════════════════════════════════════════════════════════════════════════════════
children.push(hdr1("3. Complete File Count Summary by Domain & Language"));


children.push(
  makeTable(
    ["Domain", "Primary Language(s)", "Est. Source Files", "Est. Test Files", "Config/Schema Files", "Total Files"],
    [2200, 1800, 1280, 1280, 1200, 1600],
    [
      ["1A — Matching & Execution",           "C++",              "~320",  "~120", "~30",  "~470"],
      ["1B — Unified Trading Account",        "Rust, Go",         "~95",   "~40",  "~10",  "~145"],
      ["1C — Real-Time Risk Engine",          "Rust",             "~150",  "~60",  "~15",  "~225"],
      ["1D — Market Data Distribution",       "C++, Go",          "~90",   "~35",  "~10",  "~135"],
      ["2A — User Identity Core",             "Java",             "~90",   "~40",  "~15",  "~145"],
      ["2B — Authentication Core",            "Rust",             "~100",  "~45",  "~10",  "~155"],
      ["3A — Crypto Deposits & Withdrawals",  "Rust",             "~200",  "~80",  "~20",  "~300"],
      ["3B — Fiat Banking & P2P",             "Java, Go",         "~130",  "~55",  "~20",  "~205"],
      ["4 — TradFi & CFD Platform",           "C++, Java, Go, Rust","~130","~50", "~20",  "~200"],
      ["5 — Earn & Yield Platform",           "Rust, Go, Java",   "~130",  "~55",  "~15",  "~200"],
      ["6 — Copy Trading Platform",           "Rust, Go, Java, Python","~115","~45","~12", "~172"],
      ["7 — Launchpad & Token Sales",         "Java, Rust, Solidity","~110","~45","~15",  "~170"],
      ["8 — Algo Trading & Bots",             "Rust, Go, Python", "~110",  "~45",  "~15",  "~170"],
      ["9 — Crypto Loans & Lending",          "Rust, Java",       "~80",   "~30",  "~10",  "~120"],
      ["10 — NFT & Digital Assets",           "Rust, Solidity, Go","~90",  "~35",  "~12",  "~137"],
      ["11 — Blockchain & Web3 Infra",        "Rust, Solidity, Go","~180", "~70",  "~20",  "~270"],
      ["12 — AI, Quant & Research",           "Python, Rust, CUDA","~160", "~65",  "~25",  "~250"],
      ["13A — Frontend Web App",              "TypeScript",        "~280",  "~100", "~30",  "~410"],
      ["13B — Mobile Apps (Android + iOS)",   "Kotlin, Swift",     "~240",  "~90",  "~20",  "~350"],
      ["14 — Messaging & Streaming",          "Go, Kafka, NATS",  "~80",   "~30",  "~40",  "~150"],
      ["15 — User Growth & Retention",        "Go, Java, Python", "~130",  "~50",  "~15",  "~195"],
      ["16 — Infrastructure & SRE",           "Go, HCL, YAML",    "~300",  "~40",  "~420", "~760"],
      ["17 — Database Architecture",          "SQL, PL/pgSQL",     "~120",  "~40",  "~60",  "~220"],
      ["18 — FPGA & Hardware",                "Verilog/VHDL, C++","~35",   "~15",  "~10",  "~60"],
      ["─ TOTALS ─",                          "12 languages",      "~3,265","~1,295","~960","~5,520"],
    ],
  ),
  new Paragraph({ spacing: { after: 200 } }),
);


// ════════════════════════════════════════════════════════════════════════════════
//  FOOTER
// ════════════════════════════════════════════════════════════════════════════════
children.push(
  divider(ACCENT_BLUE),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "TigerEx Technical Specification — Confidential — May 2026", size: 18, color: "888888", font: "Arial" })],
  }),
);


// ════════════════════════════════════════════════════════════════════════════════
//  DOCUMENT ASSEMBLY
// ════════════════════════════════════════════════════════════════════════════════
const doc = new Document({
  creator: "TigerEx Engineering",
  title: "TigerEx Complete Technical Specification",
  description: "Full language, file count, and domain breakdown for TigerEx exchange platform",
  styles: {
    default: {
      document: { run: { font: "Arial", size: 22, color: "1A1A1A" } },
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: DARK_NAVY },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: MID_NAVY },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: ACCENT_BLUE },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { font: "Arial" } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25e6", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } }, run: { font: "Arial" } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_BLUE, space: 1 } },
            children: [
              new TextRun({ text: "TigerEx Technical Specification  |  Confidential", size: 18, color: "888888", font: "Arial" }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COL, space: 1 } },
            children: [
              new TextRun({ text: "Page ", size: 18, color: "888888", font: "Arial" }),
              new PageNumber(),
              new TextRun({ text: "  |  TigerEx Engineering  |  May 2026", size: 18, color: "888888", font: "Arial" }),
            ],
          }),
        ],
      }),
    },
    children,
  }],
});


Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/workspace/project/TigerEx/outputs/TigerEx_Complete_Technical_Specification.docx', buffer);
  console.log('Document written successfully');
});