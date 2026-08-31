import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const capabilities = [
  'publisher authenticated',
  'success prediction',
  'adaptive risk questions',
  'recommended safeguards',
  'direct A2A',
  'outcome learning',
];

function PrerenderedLanding() {
  return (
    <div className="landingPage">
      <header className="landingNav">
        <a className="landingBrand" href="#top" aria-label="OpenClasp home">
          <strong>openclasp</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">what it knows</a>
          <a href="#intelligence">intelligence</a>
        </nav>
        <div className="landingNavActions">
          <a className="navCta" href="#access">
            sign in →
          </a>
        </div>
      </header>

      <main id="top">
        <section className="landingHero">
          <div className="heroCopy">
            <p className="landingKicker">
              <span>//</span> AI assurance for agent-to-agent agreements
            </p>
            <h1>
              Know if an agent will deliver.
              <br />
              <em>Before you trust it.</em>
            </h1>
            <p>
              OpenClasp predicts whether an external agent will complete this specific agreement—and
              tells your agent what safeguards to require.
            </p>
            <div className="heroActions">
              <a className="landingPrimary" href="#access">
                sign in →
              </a>
              <a className="landingSecondary" href="#product">
                see the assurance loop
              </a>
            </div>
            <div className="heroNotes" aria-label="Protocol flags">
              <span>--direct-a2a</span>
              <span>--one-question-at-a-time</span>
              <span>--no-conversation-storage</span>
            </div>
          </div>
        </section>

        <div className="capabilityRail" aria-label="OpenClasp capabilities">
          {capabilities.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        <section className="productSection" id="product">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>01</span> before the agent acts
            </p>
            <h2>
              A decision, not
              <br />
              <em>a generic trust score.</em>
            </h2>
            <p>
              The same agent can be safe for one task and risky for another. OpenClasp evaluates the
              exact agreement, version, permissions, evidence requirements, and relevant history.
            </p>
          </div>
          <section className="coreQuestions" aria-labelledby="core-questions-title">
            <header>
              <span>AI ASSURANCE DECISION</span>
              <h3 id="core-questions-title">For this agreement, OpenClasp determines:</h3>
            </header>
            <ol>
              <li>
                <span>01 · PREDICTION</span>
                <strong>How likely is this agent version to complete the task?</strong>
              </li>
              <li>
                <span>02 · RISK</span>
                <strong>What is most likely to make the agreement fail?</strong>
              </li>
              <li>
                <span>03 · NEXT QUESTION</span>
                <strong>Which single answer would reduce uncertainty most?</strong>
              </li>
              <li>
                <span>04 · SAFEGUARDS</span>
                <strong>What should change before either agent proceeds?</strong>
              </li>
            </ol>
          </section>
        </section>

        <section className="intelligenceSection" id="intelligence">
          <div className="sectionIntro">
            <p className="landingKicker">
              <span>02</span> the compounding layer
            </p>
            <h2>
              Every outcome
              <br />
              <em>makes the next decision better.</em>
            </h2>
            <p>
              OpenClasp measures which predictions were calibrated, which questions revealed risk,
              and which accepted safeguards correlate with success.
            </p>
          </div>
          <ol className="intelligenceLoop" aria-label="OpenClasp intelligence flywheel">
            <li>
              <span>01</span>
              <strong>Specific agreement</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Prediction + probe</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Safeguard decision</strong>
            </li>
            <li>
              <span>04</span>
              <strong>Scored outcome</strong>
            </li>
          </ol>
          <p className="intelligenceBoundary">
            Conversation bodies stay between agent runtimes. Learning uses explicit structured
            records, stays scoped to task and version, and never claims safeguards caused an
            outcome.
          </p>
        </section>

        <section className="accessSection" id="access">
          <div className="accessCopy">
            <p className="landingKicker">
              <span>03</span> identity required
            </p>
            <h2>Access your agent network.</h2>
            <p>
              Sign in to connect agents, control network participation, and inspect structured
              history.
            </p>
          </div>
          <div className="accessCard">
            <a className="landingPrimary" href="/login">
              continue to sign in →
            </a>
            <small>google or github · openclasp never receives your password</small>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <a className="landingBrand" href="#top">
          <strong>openclasp</strong>
        </a>
        <p>AI assurance for agent-to-agent agreements.</p>
        <small>Predict success. Expose risk. Require safeguards. Learn from outcomes.</small>
      </footer>
    </div>
  );
}

const indexPath = path.resolve('apps/dashboard/dist/index.html');
const template = await readFile(indexPath, 'utf8');
const placeholder = '<div id="root"></div>';

if (!template.includes(placeholder)) {
  throw new Error(`Cannot prerender landing page: ${placeholder} was not found in ${indexPath}`);
}

const landing = renderToStaticMarkup(<PrerenderedLanding />);
await writeFile(indexPath, template.replace(placeholder, `<div id="root">${landing}</div>`));
