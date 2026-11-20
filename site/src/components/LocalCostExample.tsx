import { useState } from 'react'
import { billAmount } from '../lib/format'
import { readQuantity } from '../lib/worked-examples'

export default function LocalCostExample() {
  const [hours, setHours] = useState('')
  const [rate, setRate] = useState('')
  const [extras, setExtras] = useState('')
  const [pages, setPages] = useState('')
  const accepted = readQuantity(pages)
  const costs = [hours, rate, extras]
  const valid = costs.every((v) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
  const billed = Number(hours) * Number(rate) + Number(extras)
  const result = valid && accepted && Number.isFinite(billed) ? billed / accepted : null
  return (
    <section className="workbench">
      <h2>What does one usable page of OCR cost?</h2>
      <p>
        Run a sample of scanned pages through your chosen model. Count the pages that pass your
        quality check. Use the billed time for the whole machine, including setup and idle time,
        over that same sample.
      </p>
      <div className="reader-controls">
        <label>
          Billed machine hours
          <input
            type="number"
            min="0"
            step="any"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        <label>
          Whole machine cost per hour ($)
          <input
            type="number"
            min="0"
            step="any"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label>
          Other sample costs ($)
          <input
            type="number"
            min="0"
            step="any"
            value={extras}
            onChange={(e) => setExtras(e.target.value)}
          />
        </label>
        <label>
          Pages accepted
          <input
            type="number"
            min="0"
            step="1"
            value={pages}
            onChange={(e) => setPages(e.target.value)}
          />
        </label>
      </div>
      <div className="bill-result" aria-live="polite">
        <span>Cost per accepted page</span>
        <strong>{result === null ? 'Awaiting your measurements' : billAmount(result)}</strong>
      </div>
      <p>
        Include review time, energy and storage in other costs where applicable. Enter zero if the
        machine rate already covers them. At least one accepted page is needed for a unit cost.
      </p>
      <a href="/notes/surya-25-local-ocr-license-costs/">
        See how serving setup affects Surya 2.5 →
      </a>
    </section>
  )
}
