// define variables
const tbody = document.getElementById("tbody")
const tpl = document.getElementById("rowTemplate")
const viewport = document.getElementById("tableViewport")
const topSpacer = document.getElementById("topSpacer")
const bottomSpacer = document.getElementById("bottomSpacer")
const resultCount = document.getElementById("resultCount")
const downloadCsvBtn = document.getElementById("downloadCsvBtn")
const downloadFastaBtn = document.getElementById("downloadFastaBtn")
const downloadFastaDropdown = document.querySelector("[data-download-dropdown]")
const tableSearchInput = document.getElementById("tableSearchInput")
const tableSearchForm = document.getElementById("tableSearchForm")
const databaseLoading = document.getElementById("databaseLoading")
const CSV_PATH = "./results/PQQ.csv"
const USER_RECORDS_PATH = "/api/v1/database/user-records"

const ROW_HEIGHT = 56 // must match CSS .data-row height
const BUFFER = 10

let allData = [] // Store all data from CSV
let visibleRows = []
const currentSort = { key: null, dir: "asc" }
let _currentSearchQuery = "" // Store current search query

const table = document.getElementById("LanTree-table")
if (!tbody || !tpl || !viewport || !topSpacer || !bottomSpacer || !table) {
  throw new Error("Missing required table elements in database.html")
}

const headers = Array.from(table.querySelectorAll("thead th[data-column-name]"))

const rowCellMap = {
  ".col-Organism": "Organism",
  ".col-Env": "Isolation Source",
  // ".col-Regulon": "Regulon",
  // ".col-PredGrowthTemp": "PredGrowthTemp",
  ".col-ContigAcc": "Contig",
  ".col-GTDBPhylo": "GTDB Taxonomy",
  // ".col-Cluster": "cluster",
  ".col-Provenance": "Provenance"
}

const sortKeyMap = {
  "Organism": "Organism",
  "MetalDependence": "MetalDependence",
  "Env": "Isolation Source",
  "GenomeID": "GenomeID",
  // "Regulon": "Regulon",
  // "PredGrowthTemp": "PredGrowthTemp",
  "ContigAcc": "Contig",
  "GTDBPhylo": "GTDB Taxonomy",
  "Provenance": "Provenance"
}

const searchableColumnKeys = headers.map(
  (th) => sortKeyMap[th.dataset.columnName] ?? th.dataset.columnName,
)

// parse CSV text into array of objects, using first line as keys
// function parseCSVToObjects(csvText) {
//   const lines = csvText.trim().split(/\r?\n/)
//   const csvHeaders = lines[0].split(",").map((h) => h.trim())

//   return lines
//     .slice(1)
//     .filter((line) => line.trim().length > 0)
//     .map((line) => {
//       const cols = line.split(",")
//       const obj = {}
//       csvHeaders.forEach((header, i) => (obj[header] = (cols[i] ?? "").trim()))
//       return obj
//     })
// }

function parseCSVToObjects(csvText) {
    return Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    }).data
}

function cleanGTDBPhylo(taxonomy) {
  // Remove x__ pattern where x is a single letter (d__, p__, c__, o__, f__, g__, s__)
  return String(taxonomy || "").replace(/[a-z]__/g, "").replace(/;/g, " → ");
}

function metalDependenceFromLDE(ldeValue) {
  const value = String(ldeValue ?? "").trim()
  if (value === "") return ""

  const numericValue = Number(value)
  if (numericValue === 1) return "Ln"
  if (numericValue === 0) return "Ca"
  return ""
}

function organismFromTaxonomy(taxonomy) {
  const ranks = String(taxonomy ?? "").split(";").reverse()
  for (const rank of ranks) {
    const name = rank.replace(/^[a-z]__/, "").trim()
    if (name) return name
  }
  return ""
}

function provenanceFromGenomeId(genomeId) {
  const value = String(genomeId ?? "").trim().toUpperCase()
  if (value.includes("AFDB")) return "AFDB"

  // GTDB uses RS_/GB_ prefixes for RefSeq/GenBank genomes. Accept GC as
  // well so unprefixed GCA/GCF accessions receive the same provenance.
  if (/^(RS|GB|GC)/.test(value)) return "GTDB"
  return ""
}

function normalizeDatabaseRow(row, defaultProvenance = "") {
  const taxonomy =
    row["GTDB Taxonomy"] ?? row.gtdb_taxonomy ?? row.GTDB ?? ""
  const metalDependence =
    row.MetalDependence ??
    row["Metal Dependence"] ??
    metalDependenceFromLDE(row.LDE)

  return {
    ...row,
    GenomeID: row.GenomeID ?? row.Genome ?? "",
    Contig: row.Contig ?? row.contig ?? "",
    "GTDB Taxonomy": taxonomy,
    "Isolation Source":
      row["Isolation Source"] ?? row.ncbi_isolation_source ?? "",
    Organism: row.Organism ?? organismFromTaxonomy(taxonomy),
    MetalDependence: metalDependence,
    Provenance:
      row.Provenance || provenanceFromGenomeId(row.GenomeID ?? row.Genome) || defaultProvenance,
  }
}

// Build one visible LanTree database row.
function buildRowNode(row, idx) {
  const node = tpl.content.cloneNode(true)
  const tr = node.querySelector("tr")

  // checkbox + label wiring
  const input = tr.querySelector('input[type="checkbox"]')
  const label = tr.querySelector("label")
  const checkboxId = `_r_${idx}`

  input.dataset.id = row.GeneAcc || row.GenomeID || String(idx)
  input.id = checkboxId

  label.htmlFor = checkboxId
  label.setAttribute("aria-label", input.dataset.id)

  // accession link
  const GenomeID = String(row.GenomeID ?? "")
  const genomeParts = GenomeID.split("_")
  const GenomeIDRaw =
    genomeParts.length >= 3 ? `${genomeParts[1]}_${genomeParts[2]}` : GenomeID
  const genomeA = tr.querySelector(".col-GenomeID a.genome-link")

  if (genomeA) {
    genomeA.textContent = GenomeIDRaw
    genomeA.href = GenomeIDRaw
      ? `https://gtdb.ecogenomic.org/genome?gid=${encodeURIComponent(GenomeIDRaw)}`
      : "#"
    genomeA.setAttribute("translate", "no")
  }

  // Fill row text cells using a selector-to-key map to keep field wiring centralized.
  Object.entries(rowCellMap).forEach(([selector, key]) => {
    const cell = tr.querySelector(selector)
    if (!cell) return;

    let value = row[key] || "";
    // Clean GTDBPhylo values to remove x__ prefixes
    if (selector === ".col-GTDBPhylo") {
        value = cleanGTDBPhylo(value)
    }    
      
    cell.textContent = value
  })

  const metalCell = tr.querySelector(".col-MetalDependence")
  if (metalCell) {
    const value = String(row.MetalDependence ?? "").trim()
    if (value) {
      const tag = document.createElement("span")
      tag.className = `metal-tag metal-tag--${value.toLowerCase()}`
      tag.textContent = value
      tag.setAttribute("translate", "no")
      metalCell.textContent = ""
      metalCell.appendChild(tag)
    } else {
      metalCell.textContent = ""
    }
  }

  return node
}

// virtualization
function renderVirtualRows() {
  const total = visibleRows.length
  const scrollTop = viewport.scrollTop
  const viewportHeight = viewport.clientHeight

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER)
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER,
  )

  const topHeight = start * ROW_HEIGHT
  const bottomHeight = (total - end) * ROW_HEIGHT

  topSpacer.firstElementChild.style.height = `${topHeight}px`
  bottomSpacer.firstElementChild.style.height = `${bottomHeight}px`

  tbody.querySelectorAll(".data-row").forEach((row) => row.remove())

  const fragment = document.createDocumentFragment()
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRowNode(visibleRows[i], i + 1))
  }

  bottomSpacer.before(fragment)
}

function renderTable(rows) {
  visibleRows = [...rows]
  viewport.scrollTop = 0
  renderVirtualRows()
}

function updateResultCount(count) {
  if (!resultCount) return
  const label = count === 1 ? "result" : "results"
  resultCount.textContent = ` ${count.toLocaleString()} ${label} `
}

function isNumberLike(v) {
  const s = String(v ?? "").trim()
  return s !== "" && !Number.isNaN(Number(s))
}

function getSortBucket(value) {
  const normalized = String(value ?? "").trim()

  if (normalized === "") return "blank"
  if (isNumberLike(normalized)) return "number"
  return "text"
}

function compareValues(a, b, dir) {
  const A = String(a ?? "").trim()
  const B = String(b ?? "").trim()

  const bucketOrder = { text: 0, number: 1, blank: 2 }
  const bucketA = getSortBucket(A)
  const bucketB = getSortBucket(B)

  if (bucketA !== bucketB) {
    return bucketOrder[bucketA] - bucketOrder[bucketB]
  }

  if (bucketA === "blank") {
    return 0
  }

  if (bucketA === "number") {
    const cmp = Number(A) - Number(B)
    return dir === "asc" ? cmp : -cmp
  }

  const cmp = A.localeCompare(B, undefined, {
    numeric: true,
    sensitivity: "base",
  })
  return dir === "asc" ? cmp : -cmp
}

// Filter rows based on search query across all columns
function filterRows(rows, query) {
  if (!query.trim()) {
    return [...rows]
  }

  const lowerQuery = query.toLowerCase()
  return rows.filter((row) => {
    // Check if query matches any visible column value.
    return searchableColumnKeys.some((key) => {
      const value = row[key]
      const cellValue = String(value ?? "").toLowerCase()
      return cellValue.includes(lowerQuery)
    })
  })
}

function sortBy(key) {
  if (currentSort.key === key) {
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc"
  } else {
    currentSort.key = key
    currentSort.dir = "asc"
  }

  headers.forEach((th) => {
    th.classList.remove(
      "data-table__header-cell--ascend",
      "data-table__header-cell--descend",
    )
    const thKey = sortKeyMap[th.dataset.columnName] ?? th.dataset.columnName
    if (thKey === key) {
      th.classList.add(
        currentSort.dir === "asc"
          ? "data-table__header-cell--ascend"
          : "data-table__header-cell--descend",
      )
    }
  })

  // Apply sort to currently filtered rows
  const sorted = [...visibleRows].sort((r1, r2) => {
    return compareValues(r1[key], r2[key], currentSort.dir)
  })

  visibleRows = sorted
  renderVirtualRows()
}

// Apply search filter and update display
function applySearch(query) {
  _currentSearchQuery = query
  const filteredRows = filterRows(allData, query)

  // If there's a current sort, apply it to filtered results
  if (currentSort.key) {
    filteredRows.sort((r1, r2) => {
      return compareValues(
        r1[currentSort.key],
        r2[currentSort.key],
        currentSort.dir,
      )
    })
  }

  visibleRows = filteredRows
  viewport.scrollTop = 0
  renderVirtualRows()
  updateResultCount(filteredRows.length)
}

headers.forEach((th) => {
  th.addEventListener("click", () => {
    const key = sortKeyMap[th.dataset.columnName] ?? th.dataset.columnName
    sortBy(key)
  })
})

// Add search functionality
if (tableSearchForm && tableSearchInput) {
  tableSearchForm.addEventListener("submit", (e) => {
    e.preventDefault()
    const query = tableSearchInput.value
    applySearch(query)
  })

  // Also search on input change for real-time filtering
  tableSearchInput.addEventListener("input", (e) => {
    const query = e.target.value
    applySearch(query)
  })
}

async function downloadCurrentCsv() {
  const blob = new Blob([Papa.unparse(allData)], { type: "text/csv;charset=utf-8" })
  const blobUrl = URL.createObjectURL(blob)
  const tempLink = document.createElement("a")
  tempLink.href = blobUrl
  tempLink.download = "PQQ.csv"
  document.body.appendChild(tempLink)
  tempLink.click()
  tempLink.remove()
  URL.revokeObjectURL(blobUrl)
}

if (downloadCsvBtn) {
  downloadCsvBtn.addEventListener("click", () => {
    downloadCurrentCsv().catch((error) => {
      console.error("Error downloading CSV:", error)
      window.location.href = CSV_PATH
    })
  })
}

function setFastaDropdownOpen(isOpen) {
  if (!downloadFastaDropdown || !downloadFastaBtn) return

  downloadFastaDropdown.classList.toggle("is-open", isOpen)
  downloadFastaBtn.setAttribute("aria-expanded", String(isOpen))
}

if (downloadFastaBtn && downloadFastaDropdown) {
  downloadFastaBtn.addEventListener("click", (event) => {
    event.stopPropagation()
    const isOpen = !downloadFastaDropdown.classList.contains("is-open")
    setFastaDropdownOpen(isOpen)
  })

  downloadFastaDropdown.addEventListener("click", (event) => {
    const target = event.target
    if (target instanceof HTMLAnchorElement) {
      setFastaDropdownOpen(false)
    }
  })

  document.addEventListener("click", (event) => {
    if (!downloadFastaDropdown.contains(event.target)) {
      setFastaDropdownOpen(false)
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setFastaDropdownOpen(false)
    }
  })
}

let rafPending = false
viewport.addEventListener("scroll", () => {
  if (!rafPending) {
    rafPending = true
    requestAnimationFrame(() => {
      renderVirtualRows()
      rafPending = false
    })
  }
})

// load CSV, parse, and add rows to table
Promise.all([
  fetch(CSV_PATH).then((r) => {
    if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`)
    return r.text()
  }),
  fetch(USER_RECORDS_PATH).then((r) => {
    if (!r.ok) return []
    return r.json()
  }).catch(() => []),
])
  .then(([csvText, userRows]) => {
    const gtdbRows = parseCSVToObjects(csvText).map((row) =>
      normalizeDatabaseRow(row),
    )
    const normalizedUserRows = userRows.map((row) => normalizeDatabaseRow(row))
    const rows = [...gtdbRows, ...normalizedUserRows].reverse()
    console.log(`Parsed ${gtdbRows.length} GTDB rows and ${userRows.length} user rows.`)
    allData = rows
    renderTable(rows)
    updateResultCount(rows.length)
    if (databaseLoading) databaseLoading.hidden = true
  })
  .catch((error) => {
    console.error("Error loading CSV:", error)
    if (databaseLoading) {
      databaseLoading.textContent = "Unable to load database records. Please try again."
      databaseLoading.classList.add("is-error")
    }
  })
