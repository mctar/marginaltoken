export default function UnderstandPage() {
  return (
    <main id="main" className="reader-page guide-page">
      <header className="reader-heading">
        <h1>Understand the model market</h1>
        <p>Three questions to ask when a new model lands.</p>
      </header>
      <section id="task">
        <h2>What job does it do?</h2>
        <p>
          Imagine a recorded interview. A transcription model writes down the words. A diarization
          model marks when each speaker talked. A text model can then summarise the transcript.
          Check a few difficult passages before pricing the whole collection.
        </p>
        <a href="/explore/?task=diarization">Explore speaker attribution →</a>
      </section>
      <section id="access">
        <h2>How can I use it?</h2>
        <p>
          With a hosted API, you send a request to a provider that runs the model. With downloadable
          weights, you can run the model on compatible hardware under the publisher’s license. Some
          models offer both paths. For a download, check the exact files, the license, and the
          memory needed while it runs.
        </p>
        <p>
          A release announcement, an accessible download and a generally available API can arrive on
          different dates. The source and review date on a model profile tell you what was checked.
        </p>
        <a href="/explore/?q=download">Find a downloadable model →</a>
      </section>
      <section id="cost">
        <h2>What counts towards the bill?</h2>
        <p>
          Text services often count input and output tokens separately. Voice services may charge
          for audio tokens or session time. An image service might meter images, pixels or tokens.
          Use the units printed on the tariff for the exact service you plan to use.
        </p>
        <p>
          For self-hosting, start with machine hours and completed work. Include idle capacity,
          power and the people who operate the service. To compare two options, divide total cost by
          the number of results you would actually accept.
        </p>
        <a href="/costs/">Try a worked cost example →</a>
      </section>
      <section>
        <h2>Can I use a published benchmark?</h2>
        <p>
          Use it to choose what to test. Match the hardware, model variant, task and runtime before
          applying a speed figure. For example, Higurashi’s Haru-4B latency measurement uses
          compressed weights and wired audio on an M1 Max. A Bluetooth headset changes the user’s
          experience even on the same machine.
        </p>
        <a href="/notes/haru-4b-local-speech-latency-costs/">
          Read the Haru-4B measurement details →
        </a>
      </section>
    </main>
  )
}
