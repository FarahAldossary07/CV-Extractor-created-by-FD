# CV Extractor, created by FD

Turn a stack of CVs into one clean spreadsheet. Drop in multiple CVs (PDF, Word, or plain text), tell the site which details you want — *"I want name and last name, phone number, email, nationality, years of experience"* — and it lines every candidate up in a table you can export as **.csv** or **.xlsx**.

Everything runs in your browser. CVs are never uploaded to a server.

**▶ Live site: <https://cv-extractor-created-by-fd.vercel.app>**

## How to use it — a walkthrough

### Step 1 — Add the CVs

- Open the website.
- Drag and drop your CV files onto the big dashed box, or click it to browse.
- Supported formats: **PDF**, **Word (.docx)**, and plain text (.txt, .md, .rtf).
- Add as many as you like — each file shows up in a list underneath with a "ready" status once it has been read. Click **✕** next to any file to remove it.
- If a file says *"couldn't read"*, it's usually a scanned/image-only PDF with no selectable text. Re-export it as a text-based PDF or use the Word version.

### Step 2 — Choose your columns

Two ways, use whichever you prefer:

1. **Tap the chips.** First name, Last name, Phone number, Email, Nationality, and Years of experience are pre-selected. Tap any chip to toggle it — Location, Job title, Education, Skills, Languages, LinkedIn are ready to go.
2. **Type it in your own words.** Write something like:

   > I want name and last name, phone number, email, nationality, years of experience

   …and press **Set columns**. The site parses your sentence into columns, in the order you wrote them. Anything it doesn't recognise becomes a new custom chip.

#### Optional: AI-powered extraction

The built-in parser handles the standard fields well. For unusual columns (e.g. *"reason for leaving"*, *"salary expectation"*, *"notice period"*) switch on **AI-powered extraction**:

1. Expand the *AI-powered extraction* panel.
2. Tick **Use AI extraction (Claude)**.
3. Paste your own Anthropic API key (get one at [platform.claude.com](https://platform.claude.com)). The key is stored only in your browser's localStorage — never sent anywhere except directly to the Claude API.

In AI mode, each CV's text is sent to the Claude API with your key, and the model fills in exactly the columns you asked for.

### Step 3 — Extract and review

- Press **Extract information**. A status line shows progress file by file.
- The results table appears with one row per CV. The first column always shows the source file so you can trace every row back.
- **Click any cell to edit it** — fix a typo or fill a blank before exporting.
- Empty cells mean the detail wasn't found in that CV.

### Step 4 — Export

- **Export .csv** downloads `candidates.csv` (opens in Excel, Google Sheets, Numbers…).
- **Export .xlsx** downloads `candidates.xlsx`, a real Excel workbook with sized columns.

Your edits in the table are included in the export.

## Try it with the samples

The [`samples-test/`](samples-test/) folder contains three fictional CVs (one .txt, one .docx, one .pdf) you can drop in to see the whole flow in under a minute.

## Running it locally

It's a static site — no build step, no dependencies to install.

```bash
git clone https://github.com/FarahAldossary07/CV-Extractor-created-by-FD.git
cd CV-Extractor-created-by-FD
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

> Opening `index.html` directly from the file system mostly works too, but some browsers restrict PDF parsing on `file://` URLs — the local server is the reliable way.

## How it works

| Piece | What it does |
|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) | Reads text out of PDF files, in the browser |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | Reads text out of Word (.docx) files |
| Built-in smart parser | Regex + heuristics for names, emails, phones, nationality (200+ demonyms), years of experience (stated **or** computed from employment date ranges), education, skills, languages, LinkedIn, and more |
| Claude API (optional) | AI extraction for any column you can describe, using structured outputs so the answer always matches your columns |
| [SheetJS](https://sheetjs.com/) | Builds the .xlsx export |

All libraries are vendored in [`lib/`](lib/) so the site works offline and has no CDN dependencies.

## Deployment

The site is deployed on Vercel as a static site. To redeploy after changes:

```bash
vercel --prod
```

---

*CV Extractor, created by FD.*
