import reviews from '../../../collector/weights-reviewed.json'

type Review = (typeof reviews.repositories)['stepfun-ai/Step-5-Preview']
const byRepository: Record<string, Review> = reviews.repositories

export default function WeightsReview({ repository }: { repository?: string }) {
  const review = repository ? byRepository[repository] : undefined
  if (!review) return null
  const overdue = Date.now() - Date.parse(review.reviewedAt) > 30 * 86400000
  return (
    <section className="weights-review" aria-labelledby="weights-review-title">
      <p className="section-kicker">
        Deployment notes · Checked {review.reviewedAt}{overdue ? ' · Review overdue' : ''}
      </p>
      <h2 id="weights-review-title">Running these weights</h2>
      <p>{review.availability}</p>
      <p>{review.totalParametersBillion}B total parameters · {review.activeParametersBillion}B active per token.</p>
      <dl>
        {review.configurations.map((configuration) => (
          <div key={configuration.precision}>
            <dt>{configuration.precision}</dt>
            <dd>{configuration.hardware}</dd>
          </div>
        ))}
      </dl>
      <p className="decision-note">{review.caveat}</p>
      <p>{review.licenseSummary}</p>
      <div className="market-note-links">
        <a href={review.deploymentSource}>Publisher deployment examples →</a>
        <a href={review.licenseSource}>{review.licenseName} · reviewed terms →</a>
        <a href={`https://huggingface.co/${review.bf16Repository}`}>BF16 weights →</a>
      </div>
    </section>
  )
}
