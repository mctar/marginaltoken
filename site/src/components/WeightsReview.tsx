import reviews from '../../../collector/weights-reviewed.json'

type Review = Pick<(typeof reviews.repositories)['stepfun-ai/Step-5-Preview'],
  'reviewedAt' | 'availability' | 'licenseSummary' | 'licenseSource' | 'licenseName'> &
  Partial<Pick<(typeof reviews.repositories)['stepfun-ai/Step-5-Preview'],
    'totalParametersBillion' | 'activeParametersBillion' | 'configurations' |
    'caveat' | 'deploymentSource' | 'bf16Repository'>> &
  { nvfp4Repository?: string; weightsRepository?: string }
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
      {review.totalParametersBillion !== undefined && review.activeParametersBillion !== undefined &&
        <p>{review.totalParametersBillion}B total parameters · {review.activeParametersBillion}B active per token.</p>}
      {review.configurations && <dl>
        {review.configurations.map((configuration) => (
          <div key={configuration.precision}>
            <dt>{configuration.precision}</dt>
            <dd>{configuration.hardware}</dd>
          </div>
        ))}
      </dl>}
      {review.caveat && <p className="decision-note">{review.caveat}</p>}
      <p>{review.licenseSummary}</p>
      <div className="market-note-links">
        {review.deploymentSource && <a href={review.deploymentSource}>Publisher deployment examples →</a>}
        <a href={review.licenseSource}>{review.licenseName} · reviewed terms →</a>
        {review.bf16Repository && <a href={`https://huggingface.co/${review.bf16Repository}`}>BF16 weights →</a>}
        {review.weightsRepository && <a href={`https://huggingface.co/${review.weightsRepository}`}>Model weights →</a>}
        {review.nvfp4Repository && <a href={`https://huggingface.co/${review.nvfp4Repository}`}>NVFP4 weights →</a>}
      </div>
    </section>
  )
}
